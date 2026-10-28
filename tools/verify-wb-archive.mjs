// Offline archive verification and deterministic compact-model generation.
// No network, database writes, tokens, or raw financial rows in console output.
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile,chmod} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {aggregateFinanceRows,mergeFinanceModels} from '../supabase/functions/wb-api/cabinet.ts';
import {cents} from '../supabase/functions/wb-api/core.ts';
import {withoutSalesFields} from '../supabase/functions/wb-api/sales-repair.ts';

const directory=resolve(process.argv[2]), runtime=resolve(process.argv[3]);
const openpgp=createRequire(join(runtime,'package.json'))('openpgp');
const password=(await readFile(join(directory,'passphrase.txt'),'utf8')).trim();
const {jobs}=JSON.parse(await readFile(join(directory,'snapshots.json'),'utf8'));
const manifestName=process.argv[4] || 'manifest.json';
assert.match(manifestName,/^manifest[\w-]*\.json$/);
const manifest=JSON.parse(await readFile(join(directory,manifestName),'utf8'));
assert.equal(manifest.complete,true,'never compact from a partial archive');
const entries=new Map(manifest.pages.map(p=>[p.filename,p]));
const archived=new Map(jobs.map(j=>[j.id,[]]));
const filenames=(await readdir(directory)).filter(f=>/^[a-f\d-]{36}-\d+\.json$/.test(f));
assert.equal(filenames.length,entries.size);
for(const filename of filenames) {
 const record=entries.get(filename);assert.ok(record,'archive file must appear in the manifest');
 archived.get(record.job_id).push(record);
}
const canonicalObject=value=>Array.isArray(value)?value.map(canonicalObject):value && typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,canonicalObject(v)])):value;
const models=[];let archivedRows=0,matched=0;
for(const job of jobs) {
 let model=null,after='0';
 for(const page of archived.get(job.id).sort((a,b)=>BigInt(a.after_id)<BigInt(b.after_id)?-1:1)) {
  assert.equal(page.after_id,after,'archive page continuity mismatch');after=page.last_id;
  // Read/decrypt only one chunk at a time; never retain the operation history.
  const record=JSON.parse(await readFile(join(directory,page.filename),'utf8'));
  const binary=Buffer.from(record.archive,'base64');
  assert.equal(createHash('sha256').update(binary).digest('hex'),page.sha256,'archive checksum mismatch');
  assert.equal(record.sha256,page.sha256);
  const message=await openpgp.readMessage({binaryMessage:binary});
  const {data}=await openpgp.decrypt({message,passwords:[password]});
  const rows=JSON.parse(data);assert.equal(rows.length,page.rows);
  let cursor=BigInt(page.after_id);
  for(const row of rows) {assert.ok(BigInt(row.rrd_id)>cursor);cursor=BigInt(row.rrd_id);assert.equal(String(row.payload.rrdId),row.rrd_id);}
  assert.equal(String(cursor),page.last_id);
  archivedRows+=rows.length;
  const committed=rows.filter(r=>BigInt(r.rrd_id)<=BigInt(job.cursor_id)).map(r=>r.payload);
  model=mergeFinanceModels(model,aggregateFinanceRows(committed,String(job.cursor_id)));
 }
 model ||= aggregateFinanceRows([],String(job.cursor_id));
 assert.equal(model.row_count,job.row_count,'committed snapshot rows do not match the archive');
 for(const [key,value] of Object.entries(job.summary?.totals || {})) assert.equal(cents(value),cents(model.totals[key]),`snapshot total mismatch: ${key}`);
 if(job.finance_model?.version===1 && Number(job.finance_model.row_count)===job.row_count && job.finance_model.cursor_id===String(job.cursor_id)) {
  const canonical=m=>JSON.stringify(canonicalObject({...m,products:[...m.products].sort((a,b)=>a.article<b.article?-1:a.article>b.article?1:0)}));
  const legacy=job.finance_model.sales_covered_rows !== job.finance_model.row_count || job.finance_model.totals.salesAmount == null;
  assert.equal(canonical(legacy?withoutSalesFields(model):model),canonical(legacy?withoutSalesFields(job.finance_model):job.finance_model),'existing dashboard model changed');matched++;
 }
 models.push({id:job.id,shop_id:job.shop_id,cursor_id:String(job.cursor_id),row_count:job.row_count,finance_model:model});
 archived.set(job.id,[]);
 console.log(JSON.stringify({verifiedSnapshots:models.length,archivedRows}));
}
assert.equal(archivedRows,manifest.rows);
await writeFile(join(directory,'compact-models.json'),JSON.stringify({models}),{mode:0o600});
const updates=models.map(j=>`update public.wb_api_preview_jobs set finance_model='${JSON.stringify(j.finance_model).replaceAll("'","''")}'::jsonb where id='${j.id}' and shop_id='${j.shop_id}' and cursor_id=${j.cursor_id} and row_count=${j.row_count};`).join('\n');
await writeFile(join(directory,'persist-models.sql'),`set transaction read write;\n${updates}\nselect count(*) as valid_models from public.wb_api_preview_jobs where finance_model->>'version'='1' and finance_model->>'cursor_id'=cursor_id::text and (finance_model->>'row_count')::bigint=row_count;\n`,{mode:0o600});
await chmod(join(directory,'snapshots.json'),0o600);
console.log(JSON.stringify({verified:true,archivedRows,snapshots:models.length,matchedExistingModels:matched,modelBytes:Buffer.byteLength(JSON.stringify(models))}));
