import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Actual UI boundary, deterministic WB cooldown; no real keys or network.
const elements = new Map(), calls = [], timers = [];
const el = (id) => {
  if (!elements.has(id)) elements.set(id, { value: '', dataset: {}, events: {}, addEventListener(type, fn) { this.events[type] = fn; } });
  return elements.get(id);
};
const job = { id: 'test-job', status: 'loading', date_from: '2026-09-01', date_to: '2026-09-30', row_count: 0 };
const connection = { seller_name: 'Test seller', next_request_at: '2026-10-10T04:34:00Z' };
const window = { WBAuth: { getSession: async () => ({ access_token: 'fake-session' }) }, WB_CONFIG: { SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'public-test' } };
vm.runInNewContext(readFileSync(new URL('../assets/wb-api.js', import.meta.url), 'utf8'), {
  window, document: { getElementById: el }, AbortSignal, Date, Intl, confirm: () => false,
  clearTimeout() {}, setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; },
  fetch: async (_url, options) => {
    const request = JSON.parse(options.body); calls.push(request.action);
    return new Response(JSON.stringify({ connection, job, retry_after: 43109 }));
  },
});
await window.WBApi.setContext({ shopId: 'test-shop', name: 'Test seller', allowed: true });
el('wbApiPreviewBtn').events.click();
for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve));
assert.ok(!calls.includes('preview_step'), 'browser must only enqueue/read status, never drive WB pagination');
assert.doesNotMatch(el('wbApiMessage').textContent || '', /Не закрывайте|43109 сек|Нажмите «Продолжить/);
assert.match(el('wbApiMessage').textContent || '', /фонов|сервер/i);
console.log('Background UI reproduction: passed (browser-independent scheduling).');
