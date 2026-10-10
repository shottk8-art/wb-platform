import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { ApiError, FINANCE_FIELDS, PILOT_USER_ID, PILOT_SHOP_ID, keyInfo, pageCursor, sanitizeRows, summarize, upstreamError, validateKey, validatePeriod, validateShopId } from '../supabase/functions/wb-api/core.ts';
import { processPage } from '../supabase/functions/wb-api/process.ts';
import { cabinetPeriod, processCabinetSource, readCabinet, readCabinetTrend, monthSettings } from '../supabase/functions/wb-api/cabinet.ts';

let assertions = 0;
const check = (fn) => { fn(); assertions++; };
check(() => assert.equal(validateShopId('63175e7a-5b26-425e-893f-68889b32f02f'), '63175e7a-5b26-425e-893f-68889b32f02f'));
check(() => assert.throws(() => validateShopId('../toplash'), ApiError));
check(() => assert.deepEqual(validatePeriod('2026-09-01', '2026-09-30'), { dateFrom: '2026-09-01', dateTo: '2026-09-30' }));
check(() => assert.throws(() => validatePeriod('2026-02-30', '2026-03-01'), ApiError));
check(() => assert.throws(() => validatePeriod('2026-09-30', '2026-09-01'), ApiError));
check(() => assert.throws(() => validatePeriod('2024-01-01', '2026-09-01'), ApiError));
check(() => assert.throws(() => validateKey('invalid'), ApiError));
const token = (payload) => `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${'x'.repeat(100)}`;
check(() => assert.throws(() => validateKey(token({ exp: 1 })), /истёк/));
check(() => assert.throws(() => validateKey(token({ t: true })), /песочницы/));
check(() => assert.equal(validateKey(token({ acc: 3, exp: 4102444800 })).expiresAt, '2100-01-01T00:00:00.000Z'));
check(() => assert.throws(() => validateKey(token({ acc: 1, exp: 4102444800 })), /персональный/));
check(() => assert.throws(() => validateKey(token({ acc: 4, exp: 4102444800 })), /персональный/));
check(() => assert.throws(() => validateKey(token({ exp: 4102444800 })), /персональный/));
check(() => assert.throws(() => validateKey('x'.repeat(150)), /распознать/));
check(() => assert.deepEqual(keyInfo(token({ acc: 3 })), { key_type: 'personal', finance_interval_seconds: 60 }));
check(() => assert.equal(keyInfo(token({ acc: 1 })).key_type, 'unknown'));
check(() => assert.equal(keyInfo(token({ acc: 3, t: true })).key_type, 'unknown'));
check(() => assert.equal(keyInfo('invalid').key_type, 'unknown'));
check(() => assert.equal(pageCursor([{ rrdId: '1' }, { rrdId: '2' }, { rrdId: '3' }], '2'), '3'));
check(() => assert.equal(pageCursor([], '3'), '3'));
check(() => assert.throws(() => pageCursor([{ rrdId: '4' }, { rrdId: '3' }], '2'), /не по порядку/));
check(() => assert.throws(() => pageCursor([{ rrdId: '2' }], '2'), /не продвинул/));
const rows = sanitizeRows([
  { rrdId: 1, docTypeName: 'Продажа', retailAmount: '100.10', forPay: '80.05', cashbackAmount: '10.00', cashbackCommissionChange: '1.00', cashbackDiscount: '2.10', token: 'must-not-survive', customer: 'PII' },
  { rrdId: 2, docTypeName: 'Возврат', retailAmount: '20.00', forPay: '16.00', cashbackAmount: '2.00', cashbackCommissionChange: '0.20', cashbackDiscount: '0.10' },
  { rrdId: 3, deduction: '100.00', bonusTypeName: 'Джем', paidAcceptance: '17.65', deliveryService: '30.25' },
  { rrdId: 4, deduction: '-20.00', bonusTypeName: 'Возврат аванса' },
  { rrdId: 4, deduction: '-20.00', bonusTypeName: 'Возврат аванса' },
]);
const summary = summarize(rows);
check(() => assert.equal(rows.length, 4));
check(() => assert.ok(!('token' in rows[0]) && !('customer' in rows[0])));
check(() => assert.equal(summary.totals.retailAmount, '80.10'));
check(() => assert.equal(summary.totals.forPay, '64.05'));
check(() => assert.equal(summary.totals.cashbackAmount, '8.00'));
check(() => assert.equal(summary.totals.cashbackCommissionChange, '0.80'));
check(() => assert.equal(summary.totals.cashbackDiscount, '2.00'));
check(() => assert.equal(summary.totals.deduction, '80.00'));
check(() => assert.equal(summary.totals.deliveryService, '30.25'));
check(() => assert.equal(summary.totals.paidAcceptance, '17.65'));
check(() => assert.throws(() => sanitizeRows([{ rrdId: 9007199254740992 }]), /ID/));
check(() => assert.throws(() => sanitizeRows([{ rrdId: '9007199254740992' }]), /ID/));
check(() => assert.throws(() => sanitizeRows([{ rrdId: 1, currency: 'USD' }]), /рублях/));
check(() => assert.throws(() => summarize([{ rrdId: 1, deduction: '1.005' }]), /сумму/));
check(() => assert.equal(upstreamError(429, 120).retryAfter, 120));

// Exercise the real handler with mocked Supabase/WB boundaries. No credentials,
// no real API calls, and no mutations of the user's shops.
const core = { ApiError, FINANCE_FIELDS, PILOT_USER_ID, PILOT_SHOP_ID, cabinetPeriod, processCabinetSource, readCabinet, readCabinetTrend, monthSettings, keyInfo, pageCursor, sanitizeRows, summarize, upstreamError, validateKey, validatePeriod, validateShopId, processPage };
const source = readFileSync(new URL('../supabase/functions/wb-api/index.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
let handler, authenticatedId = PILOT_USER_ID, owner = true, claimWait = 0, upstreamStatus = 204, upstreamRows = null;
let dbWrites = [], outbound = [], leaseAccepted = true, upstreamRetry = null;
const storedKey = token({ acc: 3, exp: 4102444800 });
const job = { id: '00000000-0000-4000-8000-000000000001', shop_id: '63175e7a-5b26-425e-893f-68889b32f02f', date_from: '2026-09-01', date_to: '2026-09-30', cursor_id: 0, status: 'loading' };
const chain = (table) => {
  let operation = 'select', values, count = false;
  const result = () => {
    if (operation !== 'select') dbWrites.push({ table, operation, values });
    if (table === 'shops') return { data: owner ? { id: job.shop_id, owner_id: authenticatedId } : null, error: null };
    if (table === 'wb_api_connections') return { data: { seller_id: 'seller-test', seller_name: 'Test', next_request_at: new Date().toISOString() }, error: null };
    if (table === 'wb_api_preview_jobs') {
      if (operation === 'update') Object.assign(job, values);
      return { data: job, error: null };
    }
    if (table === 'wb_api_preview_rows') return { data: [], error: null, count: 0 };
    if (table === 'wb_api_month_settings') return { data: [], error: null };
    throw new Error('Unexpected table ' + table);
  };
  const obj = {
    select(_columns, options) { count = !!options?.count; return obj; },
    eq() { return obj; }, order() { return obj; }, limit() { return obj; }, range() { return obj; },
    update(v) { operation = 'update'; values = v; return obj; },
    insert(v) { operation = 'insert'; values = v; return obj; },
    upsert(v) { operation = 'upsert'; values = v; return obj; },
    delete() { operation = 'delete'; return obj; },
    maybeSingle: async () => result(), single: async () => result(),
    then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
  };
  return obj;
};
const sandbox = {
  ...core, Response, Request, AbortSignal, Set, Date, BigInt, structuredClone,
  Deno: { env: { get: () => 'mock' }, serve: (fn) => { handler = fn; } },
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: authenticatedId ? { id: authenticatedId, user_metadata: { telegram_username: 'karlshott' } } : null }, error: null }) },
    from: chain,
    rpc: async (name) => ({ data: name === 'wb_api_read_key' ? storedKey : name === 'wb_api_accept_lease' ? (leaseAccepted ? [structuredClone(job)] : []) : claimWait, error: null }),
  }),
  fetch: async (url, options) => {
    outbound.push({ url, body: options.body });
    return new Response(upstreamStatus === 204 ? null : JSON.stringify(upstreamRows || []), { status: upstreamStatus, headers: upstreamRetry ? { 'X-Ratelimit-Retry': upstreamRetry } : {} });
  },
};
vm.runInNewContext(stripTypeScriptTypes(source), sandbox);
const invoke = async (payload, auth = true, origin = 'https://wb-platform.netlify.app') => {
  const res = await handler(new Request('https://example.test/wb-api', { method: 'POST', headers: { ...(auth ? { Authorization: 'Bearer mock-session' } : {}), Origin: origin }, body: JSON.stringify({ shop_id: job.shop_id, ...payload }) }));
  return { status: res.status, body: await res.json() };
};
check(() => assert.equal(outbound.length, 0));
assert.equal((await invoke({ action: 'status' }, false)).status, 401); assertions++;
authenticatedId = 'different-user';
assert.equal((await invoke({ action: 'status' })).status, 403); assertions++;
assert.equal(outbound.length, 0); assertions++;
authenticatedId = PILOT_USER_ID; owner = false;
assert.equal((await invoke({ action: 'status' })).status, 403); assertions++;
owner = true;
const status = await invoke({ action: 'status' });
assert.equal(status.body.connection.key_type, 'personal'); assertions++;
assert.equal(status.body.connection.finance_interval_seconds, 60); assertions++;
assert.ok(!JSON.stringify(status.body).includes(storedKey)); assertions++;
const wrongType = await invoke({ action: 'connect', api_key: token({ acc: 1, exp: 4102444800 }) });
assert.equal(wrongType.status, 400); assertions++;
assert.equal(outbound.length, 0); assertions++;
assert.equal((await invoke({ action: 'status' }, true, 'https://evil.example')).status, 403); assertions++;
claimWait = 42;
assert.equal((await invoke({ action: 'preview_step', job_id: job.id })).body.background, true); assertions++;
assert.equal(outbound.length, 0); assertions++;
const worker = async (lease = '00000000-0000-4000-8000-000000000002', origin = null) => {
  const res = await handler(new Request('https://example.test/wb-api', { method: 'POST', headers: { 'X-WB-Worker-Lease': lease, ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ job_id: job.id }) }));
  return { status: res.status, body: await res.json() };
};
assert.equal((await worker()).body.retry_after, 42); assertions++;
assert.equal(outbound.length, 0); assertions++;
assert.equal((await worker('invalid')).status, 400); assertions++;
assert.equal((await worker(undefined, 'https://wb-platform.netlify.app')).status, 403); assertions++;
leaseAccepted = false;
assert.equal((await worker()).status, 403); assertions++;
leaseAccepted = true;
claimWait = 0;
const completed = await worker();
assert.equal(job.status, 'complete'); assertions++;
assert.ok(outbound[0].url.includes('/api/finance/v1/sales-reports/detailed')); assertions++;
assert.equal(JSON.parse(outbound[0].body).dateTo, '2026-09-30T23:59:59'); assertions++;
assert.ok(dbWrites.every((item) => item.table.startsWith('wb_api_'))); assertions++;
const before = outbound.length;
assert.equal((await invoke({ action: 'preview_step', job_id: job.id })).body.cached, true); assertions++;
assert.equal(outbound.length, before); assertions++;
job.status = 'loading';
upstreamStatus = 429;
upstreamRetry = '43109';
assert.equal((await worker()).body.retry_after, 43109); assertions++;
assert.ok(Date.parse(dbWrites.findLast((item) => item.table === 'wb_api_connections').values.next_request_at) > Date.now() + 43100 * 1000); assertions++;
assert.ok(!JSON.stringify(completed.body).includes(storedKey)); assertions++;
// A brand new month has no media source and never calls WB from the browser.
const beforeCabinet = outbound.length;
const firstCabinet = await invoke({ action: 'cabinet_start', month: '2026-08' });
assert.equal(firstCabinet.status, 200); assertions++;
assert.equal(firstCabinet.body.background, true); assertions++;
assert.equal(dbWrites.findLast(item => item.operation === 'insert').values.summary.pilot.stage, 'finance'); assertions++;
assert.equal(JSON.stringify(dbWrites.findLast(item => item.operation === 'insert').values.summary.api_sources), '{}'); assertions++;
assert.equal(outbound.length, beforeCabinet); assertions++;
const originalReadCabinet=sandbox.readCabinet;
job.summary={pilot:{stage:'done'},api_sources:{orders:{status:'downloaded'},internal_ads:{status:'downloaded'},media:{status:'confirmed_by_user',amount:'0.00'}}};
sandbox.readCabinet=async()=>({job:{id:job.id,status:'complete'},complete:false,finance:{forPay:'80'},sources:{orders:{status:'downloaded'},ads:{status:'downloaded'},media:{status:'pending',amount:null}}});
assert.equal((await invoke({action:'cabinet_start',month:'2026-09'})).status,200); assertions++;
assert.equal(job.summary.pilot.stage,'media_list'); assertions++;
assert.equal(job.summary.pilot.finance_complete,true); assertions++;
assert.equal(job.summary.api_sources.media.amount,null); assertions++;
assert.equal(job.summary.api_sources.orders.status,'downloaded'); assertions++;
assert.equal(outbound.length,beforeCabinet); assertions++;
job.summary.api_sources.media={status:'loading',pending_count:8,stats_offset:2,partial_amount:'50.00',campaign_ids:[11,22,33]};
sandbox.readCabinet=async()=>({job:{id:job.id,status:'error',stage:'media_stats'},complete:false,sources:{}});
assert.equal((await invoke({action:'cabinet_start',month:'2026-09'})).status,200); assertions++;
assert.equal(job.summary.api_sources.media.pending_count,0); assertions++;
assert.equal(job.summary.api_sources.media.stats_offset,2); assertions++;
assert.equal(job.summary.api_sources.media.partial_amount,'50.00'); assertions++;
assert.equal(outbound.length,beforeCabinet); assertions++;
sandbox.readCabinet=originalReadCabinet;
assert.equal((await invoke({ action: 'cabinet', month: '2026-09', shop_id: '00000000-0000-4000-8000-000000000009' })).status, 403); assertions++;
sandbox.readCabinet = async () => ({ job: { status: 'complete' }, complete: true, sources: {} });
assert.equal((await invoke({ action: 'cabinet_start', month: '2026-09' })).body.cached, true); assertions++;
assert.equal(outbound.length, beforeCabinet); assertions++;
const settingsWrite = await invoke({action:'cabinet_settings',month:'2026-09',operational_expenses:'10.01',external_promotion_expenses:'0'});
assert.equal(settingsWrite.status,200); assertions++;
assert.equal(dbWrites.at(-1).table,'wb_api_month_settings'); assertions++;
assert.equal(dbWrites.at(-1).values.operational_expenses,'10.01'); assertions++;
assert.equal(Object.hasOwn(dbWrites.at(-1).values,'media_spend'),false); assertions++;
const writesBeforeMedia=dbWrites.length;
assert.equal((await invoke({action:'cabinet_settings',month:'2026-09',operational_expenses:0,external_promotion_expenses:0,media_spend:0})).status,400); assertions++;
assert.equal(dbWrites.length,writesBeforeMedia); assertions++;
assert.equal(dbWrites.at(-1).values.shop_id,PILOT_SHOP_ID); assertions++;
assert.equal(dbWrites.at(-1).values.month,'2026-09-01'); assertions++;
assert.equal(outbound.length,beforeCabinet); assertions++;
assert.equal((await invoke({action:'cabinet_settings',month:'2026-09',operational_expenses:-1,external_promotion_expenses:0})).status,400); assertions++;
assert.equal((await invoke({action:'cabinet_settings',month:'2026-09',shop_id:'00000000-0000-4000-8000-000000000009',operational_expenses:0,external_promotion_expenses:0})).status,403); assertions++;
authenticatedId = '00000000-0000-4000-8000-000000000099';
assert.equal((await invoke({action:'cabinet_settings',month:'2026-09',operational_expenses:0,external_promotion_expenses:0})).status,403); assertions++;
assert.equal((await invoke({action:'cabinet_trend'})).status,403); assertions++;
authenticatedId = PILOT_USER_ID;
console.log(`WB API: ${assertions} assertions passed (validation, exact amounts, privacy, access control, pagination, caching, rate limits).`);
