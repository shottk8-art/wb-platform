// One-off seller-price enrichment for saved compact months. Default: plan only.
// --apply explicitly allows bounded financial API reads and additive DB updates.
// No raw rows, credentials, financial models or SQL are logged/saved to disk.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {aggregateFinanceRows,mergeFinanceModels} from '../supabase/functions/wb-api/cabinet.ts';
import {FINANCE_FIELDS,pageCursor,sanitizeRows,validateShopId} from '../supabase/functions/wb-api/core.ts';
import {enrichSalesModel} from '../supabase/functions/wb-api/sales-repair.ts';

const run=promisify(execFile), root=fileURLToPath(new URL('../',import.meta.url));
const project='qhvrdqcixglxopwrzeha', apply=process.argv.includes('--apply');
// Only fields used by compact aggregates; avoid downloading repeated dates,
// titles and explanatory accounting fields for hundreds of thousands of rows.
const repairFields=FINANCE_FIELDS.filter(key=>!['reportId','dateFrom','dateTo','saleDt','rrDate','title',
  'rebillLogisticCost','ppvzSalesCommission','ppvzReward','acquiringFee','vw','vwNds',
  'installmentCofinancingAmount','paymentSchedule','reportType'].includes(key));
const months=process.argv.filter(a=>a.startsWith('--month=')).map(a=>a.slice(8));
const shops=process.argv.filter(a=>a.startsWith('--shop=')).map(a=>validateShopId(a.slice(7)));
const archivePath=process.argv.find(a=>a.startsWith('--archive='))?.slice(10);
const archivedModels=archivePath?JSON.parse(await readFile(archivePath,'utf8')).models:[];
if(!Array.isArray(archivedModels)) throw new Error('Invalid compact archive');
if(months.some(m=>!/^\d{4}-\d{2}$/.test(m))) throw new Error('Invalid month filter');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
let pendingSql=Promise.resolve();
async function sql(query) {
  const operation=pendingSql.then(async()=>{
    try {
      const {stdout}=await run('supabase',['db','query','--linked','--project-ref',project,'--output','json',query],
        {cwd:root,maxBuffer:8*1024*1024,timeout:60000});
      const result=JSON.parse(stdout);
      if(!Array.isArray(result.rows)) throw new Error();
      return result.rows;
    } catch(e) {
      // CLI login/profile files are shared; never launch it concurrently.
      // Only the numeric exit code is safe to retain, not stdout/stderr/query.
      throw new Error('Database operation failed ('+(Number.isInteger(e.code)?e.code:'transport')+'); details suppressed');
    }
  });
  pendingSql=operation.catch(()=>{});
  return operation;
}
const report=value=>console.log(JSON.stringify(value));
let jobs=await sql(`select j.id,j.shop_id,c.seller_id,j.date_from::text,j.date_to::text,j.cursor_id::text,j.row_count,
  j.finance_model,md5(j.finance_model::text) as model_hash,
  coalesce(j.summary->'pilot'->>'finance_period','weekly') as finance_period
  from public.wb_api_preview_jobs j join public.wb_api_connections c on c.shop_id=j.shop_id
  where j.status='complete' and j.finance_storage='aggregate'
    and (c.expires_at is null or c.expires_at>now())
    and (j.finance_model->>'sales_covered_rows' is distinct from j.row_count::text
      or j.finance_model->'totals'->>'salesAmount' is null)
  order by case
    when j.date_from=(date_trunc('month',now() at time zone 'Europe/Moscow')-interval '1 month')::date then 0
    when j.date_from=date_trunc('month',now() at time zone 'Europe/Moscow')::date then 2
    else 1 end,j.date_from desc,j.created_at desc`);
jobs=jobs.filter(j=>(!months.length || months.includes(j.date_from.slice(0,7))) && (!shops.length || shops.includes(j.shop_id)));
report({mode:apply?'apply':'plan',snapshots:jobs.length,shops:new Set(jobs.map(j=>j.shop_id)).size,
  empty:jobs.filter(j=>j.row_count===0).length});
if(!apply) process.exit(0);
let repaired=0,rejected=0,requests=0;
const groups=new Map();
for(const job of jobs) {
  validateShopId(job.id);validateShopId(job.shop_id);
  if(!/^\d+$/.test(job.cursor_id) || !/^[a-f0-9]{32}$/.test(job.model_hash) || !['weekly','daily'].includes(job.finance_period)) throw new Error('Invalid snapshot metadata');
  const group=groups.get(job.shop_id)||[];group.push(job);groups.set(job.shop_id,group);
}
await Promise.all([...groups].map(async([shopId,snapshots])=>{
  let token=null;
  try {
    const seller=snapshots[0].seller_id;
    let lastKey=null,lastModel=null;
    for(const [index,job] of snapshots.entries()) {
      let phase='load';
      try {
        const cacheKey=JSON.stringify([job.date_from,job.date_to,job.finance_period,job.cursor_id,job.row_count]);
        let model=cacheKey===lastKey?lastModel:null,cursor='0';
        model ||= archivedModels.find(m=>m.shop_id===shopId && m.date_from===job.date_from && m.date_to===job.date_to &&
          m.cursor_id===job.cursor_id && m.row_count===job.row_count && m.finance_model?.totals?.salesAmount!=null)?.finance_model;
        if(job.row_count===0) model=aggregateFinanceRows([],job.cursor_id);
        if(!model) {
          let rateRetries=0;
          if(!token) {
            const credentials=await sql(`select v.decrypted_secret as api_key from public.wb_api_connections c
              join vault.decrypted_secrets v on v.id=c.secret_id where c.shop_id=${literal(shopId)}
              and c.seller_id=${literal(seller)} and (c.expires_at is null or c.expires_at>now())`);
            if(credentials.length!==1 || typeof credentials[0].api_key!=='string') throw new Error('Key unavailable');
            token=credentials[0].api_key;credentials[0].api_key=null;
          }
          for(let page=0;page<500;page++) {
            let reservation=null;
            // Use the same per-shop clock as the live worker. If a normal
            // sync is running, do not contend with it or consume its requests.
            for(;;) {
              const [state]=await sql(`with locked as (
                select c.shop_id,c.next_request_at,
                  exists(select 1 from public.wb_api_preview_jobs j where j.shop_id=c.shop_id and j.status='loading') as busy
                from public.wb_api_connections c where c.shop_id=${literal(shopId)} and c.seller_id=${literal(seller)} for update
              ), claimed as (
                update public.wb_api_connections c set next_request_at=now()+interval '63 seconds' from locked l
                where c.shop_id=l.shop_id and l.next_request_at<=now() and not l.busy returning c.shop_id,c.next_request_at
              ) select l.busy,exists(select 1 from claimed) as claimed,
                (select next_request_at from claimed) as claimed_until,
                ceil(greatest(0,extract(epoch from l.next_request_at-now())))::int as wait from locked l`);
              if(!state || state.busy) throw new Error('Normal sync running or connection changed');
              if(state.claimed) {reservation=state.claimed_until;break;}
              if(state.wait>0) {await pause(Math.min(60000,(state.wait+1)*1000));continue;}
              await pause(1000);
            }
            phase='financial-api';
            const response=await fetch('https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed',{
              method:'POST',redirect:'error',signal:AbortSignal.timeout(120000),
              headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
              body:JSON.stringify({dateFrom:job.date_from,dateTo:`${job.date_to}T23:59:59`,period:job.finance_period,
                limit:100000,rrdId:Number(cursor),fields:repairFields}),
            });
            requests++;
            if(!response.ok) {
              const retry=Math.ceil(Number(response.headers.get('X-Ratelimit-Retry') || response.headers.get('Retry-After')) || 63);
              await response.body?.cancel();
              if(response.status===429) {
                // A rejected call did not consume a successful-request slot.
                // Respect WB's actual retry window, only replacing our own
                // reservation; do not overwrite a normal worker's newer clock.
                await sql(`update public.wb_api_connections set next_request_at=now()+make_interval(secs=>${Math.max(1,Math.min(86400,retry))+1})
                  where shop_id=${literal(shopId)} and seller_id=${literal(seller)} and next_request_at=${literal(reservation)}::timestamptz`);
                if(rateRetries<2 && retry<=180) {
                  rateRetries++;page--;
                  report({event:'rate-wait',shop:shopId,month:job.date_from.slice(0,7),retry_seconds:retry,attempt:rateRetries});
                  continue;
                }
              }
              throw Object.assign(new Error('WB rejected request'),{httpStatus:response.status,retrySeconds:retry});
            }
            rateRetries=0;
            const raw=response.status===204?[]:await response.json();
            phase='validate-page';
            const allRows=sanitizeRows(raw||[]),nextCursor=pageCursor(raw||[],cursor);
            // Restore the already committed snapshot boundary, not a new
            // financial statement. Its exact cursor/count plus all old totals
            // are checked before any update. No extra empty-page request is
            // needed when this authenticated saved boundary has been reached.
            const rows=allRows.filter(r=>BigInt(r.rrdId)<=BigInt(job.cursor_id));
            const modelCursor=rows.length?String(rows.at(-1).rrdId):model?.cursor_id || '0';
            phase='reduce-page';
            model=mergeFinanceModels(model,aggregateFinanceRows(rows,modelCursor));
            cursor=nextCursor;
            report({event:'page',shop:shopId,month:job.date_from.slice(0,7),rows:model.row_count,requests});
            if(!allRows.length || BigInt(nextCursor)>=BigInt(job.cursor_id)) break;
            if(page===499) throw new Error('Pagination bound reached');
          }
        }
        phase='model-check';
        const enriched=enrichSalesModel(job.finance_model,model);
        // Compare-and-swap the complete original JSON. All other columns,
        // sources, summary, timestamps, payout and expenses stay untouched.
        phase='save-check';
        const saved=await sql(`update public.wb_api_preview_jobs j set finance_model=${literal(JSON.stringify(enriched))}::jsonb
          where j.id=${literal(job.id)} and j.shop_id=${literal(shopId)} and j.status='complete'
            and j.cursor_id=${job.cursor_id} and j.row_count=${Number(job.row_count)}
            and md5(j.finance_model::text)=${literal(job.model_hash)}
            and exists(select 1 from public.wb_api_connections c where c.shop_id=j.shop_id and c.seller_id=${literal(seller)})
          returning j.id,j.finance_model->'totals'->>'salesAmount' as sales`);
        if(saved.length!==1) throw new Error('Saved snapshot changed');
        lastKey=cacheKey;lastModel=model;repaired++;
        report({event:'repaired',shop:shopId,month:job.date_from.slice(0,7),sales:saved[0].sales,repaired,rejected});
      } catch(e) {
        rejected++;
        report({event:'unchanged',shop:shopId,month:job.date_from.slice(0,7),phase,http_status:e.httpStatus || null,retry_seconds:e.retrySeconds || null,
          database_error:e.message?.startsWith('Database operation failed')?e.message:null,
          reason:'Source changed, incomplete, busy or unavailable; preserved saved finance',repaired,rejected});
        if(phase==='financial-api' || phase==='load') {
          rejected+=snapshots.length-index-1;
          report({event:'shop-stopped',shop:shopId,reason:'Do not retry an unavailable API or compete with normal sync'});
          break;
        }
      }
    }
  } catch(e) {rejected+=snapshots.length;report({event:'shop-unavailable',shop:shopId,snapshots:snapshots.length,
    database_error:e.message?.startsWith('Database operation failed')?e.message:null});}
  finally {token=null;}
}));
report({complete:true,repaired,rejected,requests});
process.exit(rejected?2:0);
