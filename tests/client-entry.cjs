// Exercise the actual authenticated app entry and shop filters without a real account.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('app.html', 'utf8');
const start = html.indexOf('  async function init()');
const end = html.indexOf('    try {\n      const selectedId', start);
assert(start >= 0 && end > start, 'actual first-entry boundary must be present');
const entry = html.slice(start, end) + '\n  }';

async function check(label, owned, memberships, expectedShop) {
  const reads = [], writes = [], onboarded = [], cleared = [];
  const current = { user: { id: 'entry-test-user', user_metadata: {} } };
  const nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, { hidden: true, textContent: '' }); return nodes.get(id); };
  const client = {
    auth: { getSession: async () => ({ data: { session: current } }) },
    from(table) {
      const filters = {};
      const query = {
        select() { return query; },
        eq(key, value) { filters[key] = value; return query; },
        order() { return query; },
        insert(value) { writes.push(value); throw Error('entry must not create a shop'); },
        then(resolve, reject) {
          reads.push({ table, filters });
          return Promise.resolve({ data: table === 'shops' ? owned : memberships, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const state = {
    window: { supabaseClient: client, WBAdmin: { isAdmin: async () => false }, WBOnboardingDraft: {clear: id=>cleared.push(id)}, WBClientStart: {
      firstShop: async (user, callbacks) => { onboarded.push({ user, callbacks }); return { shop: { id: 'created-only-by-onboarding' }, marketplace: 'wildberries' }; },
    } },
    document: { getElementById: node }, session: null, shop: null, aiAllowed: false,
    Date, Map, Set, Promise, setTimeout,
  };
  vm.createContext(state);
  vm.runInContext(fs.readFileSync('assets/auth.js', 'utf8'), state);
  vm.runInContext(entry, state);
  await state.init();
  assert.equal(onboarded.length, 0, 'no onboarding, even for a fresh account');
  assert.equal(state.shop?.id || null, expectedShop, label);
  assert.equal(writes.length, 0, 'opening the cabinet must not create a shop');
  assert.deepEqual(cleared,[],'old drafts are inactive, not deleted or resumed');
  assert(reads.some(r => r.table === 'shops' && r.filters.owner_id === current.user.id));
  assert(reads.some(r => r.table === 'shop_members' && r.filters.user_id === current.user.id));
  console.log(`${label}: PASS`);
}

(async () => {
  await check('New user opens an empty cabinet without creating data', [], [], null);
  await check('Existing owner opens their cabinet', [{ id: 'owned-shop' }], [], 'owned-shop');
  await check('Invited member keeps team access', [], [{ shops: { id: 'invited-shop' } }], 'invited-shop');
})().catch(error => { console.error(error); process.exitCode = 1; });
