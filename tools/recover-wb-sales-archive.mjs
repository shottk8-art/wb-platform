// Offline authenticated recovery. Read the existing archive, never modify it.
// Only compact aggregates go to the explicit private output; never raw rows.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {aggregateFinanceRows,mergeFinanceModels} from '../supabase/functions/wb-api/cabinet.ts';
import {cents} from '../supabase/functions/wb-api/core.ts';
import {enrichSalesModel} from '../supabase/functions/wb-api/sales-repair.ts';

const directory=resolve(process.argv[2]),runtime=resolve(process.argv[3]),output=resolve(process.argv[4]);
const openpgp=createRequire(join(runtime,'package.json'))('openpgp');
let password=(await readFile(join(directory,'passphrase.txt'),'utf8')).trim();
const {jobs}=JSON.parse(await readFile(join(directory,'snapshots.json'),'utf8'));
const manifest=JSON.parse(await readFile(join(directory,'manifest-verified-input.json'),'utf8'));
assert.equal(manifest.complete,true);
const models=[];let totalRows=0;
for(const job of jobs) {
  let model=null,after='0';
  const pages=manifest.pages.filter(p=>p.job_id===job.id).sort((a,b)=>BigInt(a.after_id)<BigInt(b.after_id)?-1:1);
  for(const page of pages) {
    assert.equal(page.after_id,after);
    const record=JSON.parse(await readFile(join(directory,page.filename),'utf8'));
    const binary=Buffer.from(record.archive,'base64');
    assert.equal(createHash('sha256').update(binary).digest('hex'),page.sha256);
    assert.equal(record.sha256,page.sha256);
    const message=await openpgp.readMessage({binaryMessage:binary});
    const {data}=await openpgp.decrypt({message,passwords:[password]});
    const rows=JSON.parse(data);assert.equal(rows.length,page.rows);
    let cursor=BigInt(page.after_id);
    for(const row of rows) {
      assert.ok(BigInt(row.rrd_id)>cursor);cursor=BigInt(row.rrd_id);
      assert.equal(String(row.payload.rrdId),row.rrd_id);
    }
    assert.equal(String(cursor),page.last_id);after=page.last_id;totalRows+=rows.length;
    const committed=rows.filter(r=>BigInt(r.rrd_id)<=BigInt(job.cursor_id)).map(r=>r.payload);
    model=mergeFinanceModels(model,aggregateFinanceRows(committed,String(job.cursor_id)));
  }
  model ||= aggregateFinanceRows([],String(job.cursor_id));
  assert.equal(model.row_count,job.row_count);
  for(const [key,value] of Object.entries(job.summary?.totals || {})) assert.equal(cents(value),cents(model.totals[key]));
  if(model.totals.salesAmount!=null && job.finance_model?.version===1 && job.finance_model.row_count===job.row_count &&
      String(job.finance_model.cursor_id)===String(job.cursor_id)) enrichSalesModel(job.finance_model,model);
  models.push({shop_id:job.shop_id,date_from:job.date_from,date_to:job.date_to,cursor_id:String(job.cursor_id),row_count:job.row_count,finance_model:model});
  console.log(JSON.stringify({verified:models.length,archived_rows:totalRows,sales_known:model.totals.salesAmount!=null}));
}
assert.equal(totalRows,manifest.rows);
password=null;
await writeFile(output,JSON.stringify({models}),{mode:0o600,flag:'wx'});
console.log(JSON.stringify({complete:true,snapshots:models.length,archived_rows:totalRows}));
