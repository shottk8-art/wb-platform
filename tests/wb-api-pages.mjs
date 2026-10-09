import assert from 'node:assert/strict';
import { processPage } from '../supabase/functions/wb-api/process.ts';
import { ApiError, mergeSummaries, summarize, validatePeriod } from '../supabase/functions/wb-api/core.ts';

const job = { id: 'fake-job', shop_id: 'fake-shop', cursor_id: '2', status: 'loading', summary: null };
const saved = new Map([
  ['1', { rrdId: '1', retailAmount: '100.10' }],
  ['2', { rrdId: '2', docTypeName: 'Возврат', retailAmount: '20.00' }],
]);
let failCommit = true, wait = 0, outbound = 0;
const personalKey = `e30.${Buffer.from(JSON.stringify({ acc: 3, exp: 4102444800 })).toString('base64url')}.${'x'.repeat(100)}`;
let key = personalKey;
const admin = {
  rpc: async (name) => ({ data: name === 'wb_api_read_key' ? key : wait }),
  from(table) {
    let values, range, ceiling = Infinity;
    const q = {
      select() { return q; }, eq() { return q; }, order() { return q; },
      lte(_key, value) { ceiling = Number(value); return q; },
      range(start, end) { range = [start, end]; return q; },
      update(v) { values = v; return q; }, upsert(v) { values = v; return q; },
      then(resolve, reject) {
        if (table === 'wb_api_preview_rows' && values) for (const row of values) saved.set(row.rrd_id, row.payload);
        if (table === 'wb_api_preview_jobs' && values) {
          if (failCommit) return Promise.resolve({ error: { code: 'test-failure' } }).then(resolve, reject);
          Object.assign(job, values);
        }
        return Promise.resolve({ error: null, data: range ? [...saved.values()].filter((row) => Number(row.rrdId) <= ceiling).slice(range[0], range[1] + 1).map((payload) => ({ payload })) : null }).then(resolve, reject);
      },
    }; return q;
  },
};
let page = [{ rrdId: 2, retailAmount: '20.00' }, { rrdId: 3, retailAmount: '0.01' }];
const fetcher = async (_key, _url, body) => { outbound++; assert.equal(body.limit, 50000); return page; };
await assert.rejects(() => processPage(admin, { ...job }, job.shop_id, fetcher));
assert.equal(job.cursor_id, '2');
assert.equal(saved.size, 3);
failCommit = false;
await processPage(admin, { ...job }, job.shop_id, fetcher);
// Bootstrap only committed IDs, not rows written by a crashed attempt.
assert.equal(job.summary.totals.retailAmount, '80.11');
assert.equal(job.row_count, 3);
assert.equal(saved.size, 3);
assert.equal(job.status, 'loading', 'short page is not proof of completeness');
// Following an out-of-order last ID must never silently drop financial rows.
page = [{ rrdId: 5, retailAmount: '1.00' }, { rrdId: 4, retailAmount: '1.00' }];
await assert.rejects(() => processPage(admin, { ...job }, job.shop_id, fetcher), (error) => error instanceof ApiError && error.status === 400);
assert.equal(job.cursor_id, '3');
assert.equal(saved.size, 3, 'invalid page is rejected before writes');
page = [{ rrdId: 3 }, { rrdId: 4 }, { rrdId: 3 }];
await assert.rejects(() => processPage(admin, { ...job }, job.shop_id, fetcher), /не по порядку/);
assert.equal(job.cursor_id, '3', 'dedup must not hide a non-monotonic raw page');
page = [{ rrdId: 3 }, { rrdId: 4, retailAmount: '0.01' }, { rrdId: 4, retailAmount: '0.01' }];
await processPage(admin, { ...job }, job.shop_id, fetcher);
assert.equal(job.cursor_id, '4');
assert.equal(job.summary.totals.retailAmount, '80.12');
assert.equal(job.row_count, 4, 'duplicate last row does not duplicate totals');
page = null;
await processPage(admin, { ...job }, job.shop_id, fetcher);
assert.equal(job.status, 'complete');
assert.equal(job.summary.totals.retailAmount, '80.12');
wait = 43109;
const before = outbound;
assert.equal((await processPage(admin, { ...job }, job.shop_id, fetcher)).retry_after, 43109);
assert.equal(outbound, before, 'cooldown must not send an early WB request');
wait = 0;
key = `e30.${Buffer.from(JSON.stringify({ acc: 1, exp: 4102444800 })).toString('base64url')}.${'x'.repeat(100)}`;
await assert.rejects(() => processPage(admin, { ...job }, job.shop_id, fetcher), /персональный/);
assert.equal(outbound, before, 'unsupported token type must not reach WB');
assert.equal(mergeSummaries(summarize([{ deduction: '0.10' }]), summarize([{ deduction: '0.20' }])).totals.deduction, '0.30');
assert.equal(validatePeriod('2024-01-29', '2026-09-30').dateFrom, '2024-01-29');
console.log('WB background pages: passed (crash recovery, deduplication, exact totals, history, quota).');
