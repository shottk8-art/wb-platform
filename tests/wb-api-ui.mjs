import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const elements = new Map();
const el = (id) => {
  if (!elements.has(id)) elements.set(id, { value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, dataset: {}, events: {}, addEventListener(event, fn) { this.events[event] = fn; } });
  return elements.get(id);
};
const requests = [];
let pendingResponse;
const connection = { seller_name: 'GREEN FLOW', key_type: 'personal', finance_interval_seconds: 60, checked_at: '2026-10-09T12:00:00Z' };
const window = { WBAuth: { getSession: async () => ({ access_token: 'test-session' }) }, WB_CONFIG: { SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'public-test' } };
vm.runInNewContext(readFileSync(new URL('../assets/wb-api.js', import.meta.url), 'utf8'), {
  window, document: { getElementById: el }, AbortSignal, Intl, Date, clearTimeout, setTimeout,
  confirm: () => false,
  fetch: async (_url, options) => {
    const req = JSON.parse(options.body); requests.push(req);
    if (pendingResponse) return new Promise((resolve) => { pendingResponse.resolve = resolve; });
    return new Response(JSON.stringify(req.action === 'connect' || req.shop_id === 'team' ? { connection } : { connection: null, job: null }));
  },
});
let connectionNotifications=0;window.WBApi.subscribe(()=>connectionNotifications++);
await window.WBApi.setContext({ shopId: 'a', name: 'GREEN FLOW', allowed: true });
assert.equal(connectionNotifications,1,'initial status must notify the app even before a key is connected');
assert.equal(el('secWbApi').hidden, false);
assert.equal(window.WBApi.connected,false,'file dashboards must remain available before connection');
assert.equal(el('wbApiShopName').textContent, 'GREEN FLOW');
assert.equal(el('wbApiCheckBtn').disabled, true);
assert.equal(el('wbApiKey').value, '');
el('wbApiKey').value = 'dummy-test-only';
el('wbApiKey').events.input();
assert.equal(el('wbApiConnectBtn').disabled, false);
el('wbApiConnectBtn').events.click();
assert.equal(el('wbApiKey').value, '', 'key removed from field before network request');
await new Promise((resolve) => setImmediate(resolve));
assert.equal(requests.at(-1).action, 'connect');
assert.equal(requests.at(-1).shop_id, 'a');
assert.equal(el('wbApiCheckBtn').disabled, false);
assert.equal(window.WBApi.connected,true);
assert.match(el('wbApiConnectionStatus').textContent, /GREEN FLOW/);
assert.match(el('wbApiConnectionStatus').textContent, /Персональный ключ/);
assert.doesNotMatch(el('wbApiMessage').textContent, /доступ к финансам подтверждён/i);
assert.ok(!el('wbApiConnectionStatus').textContent.includes('dummy-test-only'));
await window.WBApi.setContext({ shopId: 'b', name: 'Other store', allowed: true });
assert.equal(el('wbApiCheckBtn').disabled, true, 'old store connection reset synchronously');
assert.equal(window.WBApi.connected,false,'connection state cannot carry over between stores');
assert.equal(el('wbApiKey').value, '');
const before = requests.length;
await window.WBApi.setContext({ shopId: 'c', name: 'Other user', allowed: false });
assert.equal(el('secWbApi').hidden, true);
assert.equal(requests.length, before, 'no API request for disallowed account');
// A slow status response from a previous shop must not paint into the next shop.
pendingResponse = {};
const old = window.WBApi.setContext({ shopId: 'slow', name: 'Slow store', allowed: true });
await new Promise((resolve) => setImmediate(resolve));
await window.WBApi.setContext({ shopId: 'new', name: 'New store', allowed: false });
pendingResponse.resolve(new Response(JSON.stringify({ connection, job: null })));
await old;
assert.equal(el('secWbApi').hidden, true);
assert.equal(el('wbApiShopName').textContent, 'New store');
assert.equal(el('wbApiCheckBtn').disabled, true);
pendingResponse=undefined;
await window.WBApi.setContext({shopId:'team',name:'Team shop',allowed:true,manage:false});
assert.equal(el('secWbApi').hidden,true,'team members cannot manage credentials');
assert.equal(el('wbApiKey').disabled,true);
assert.equal(window.WBApi.connected,true,'team members can use their shop analytics');
const beforeMember=requests.length;
el('wbApiKey').value='dummy-test-only';el('wbApiConnectBtn').events.click();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(requests.length,beforeMember,'credential controls are guarded even if triggered programmatically');
await window.WBApi.cabinet('cabinet','2026-09');
assert.equal(requests.at(-1).shop_id,'team');
assert.equal(requests.at(-1).action,'cabinet');
console.log('WB API UI: PASS (all owners, connected/file fallback, owner-only key controls, team reads, stale isolation).');
