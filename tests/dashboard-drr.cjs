const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Minimal DOM for testing the public render API without dependencies or real data.
const document = {
  createElement() {
    return {
      set innerHTML(html) {
        const number = { textContent: '', isConnected: true, classList: { add() {}, remove() {} } };
        this.content = { firstChild: { html, number, querySelector: () => number } };
      },
    };
  },
};
const window = { matchMedia: () => ({ matches: true }) };
const context = vm.createContext({ window, document, Intl, Map, Date, console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/dashboard.js'), 'utf8'), context);
const api = window.WBDashboard;
const rep = {
  year: 2026, month: 9, sales_amount: 1000, orders_amount: 2000,
  bought_qty: 10, transfer_goods: 800, transfer_total: 700,
  ads_spend: 100, wb_media_spend: 50, external_promotion_expenses: 25,
  operational_expenses: 30, ads_promo_spend: 999,
};
const derived = (report) => api.computeDerived(report, [], new Map(), 0);
function cards(d, prev = null, marketplace = 'wildberries') {
  const container = { innerHTML: '', children: [], appendChild(card) { this.children.push(card); } };
  api.renderKPI(container, d, prev, marketplace);
  return container.children;
}
const find = (rows, label) => rows.find((card) => card.html.includes(`>${label}</div>`));

async function main() {
  const d = derived(rep);
  assert.equal(d.netProfit, 495, 'advertising is not deducted twice');
  const prev = derived({ ...rep, ads_spend: 80, wb_media_spend: 20, external_promotion_expenses: 0 });
  const rows = cards(d, prev);
  assert.equal(find(rows, 'ДРР (заказа)').number.textContent, '8,8');
  assert.equal(find(rows, 'ДРР (выкупа)').number.textContent, '17,5');
  assert.match(find(rows, 'ДРР (заказа)').html, /\+3,8 п.п./);
  assert.match(find(rows, 'ДРР (заказа)').html, /kpi-delta--down/);
  assert.doesNotMatch(find(rows, 'Внутренняя реклама').html, /ДРР/);
  assert.equal(find(cards(derived({ ...rep, ads_promo_spend: 0 })), 'ДРР (выкупа)').number.textContent, '17,5');
  assert.equal(find(cards(derived({ ...rep, operational_expenses: 900 })), 'ДРР (выкупа)').number.textContent, '17,5');
  const noBase = find(cards(derived({ ...rep, sales_amount: 0 }), prev), 'ДРР (выкупа)');
  assert.match(noBase.html, /kpi-number">—/);
  assert.doesNotMatch(noBase.html, /kpi-delta/);
  const zeroAds = cards(derived({ ...rep, ads_spend: 0, wb_media_spend: 0, external_promotion_expenses: 0 }));
  assert.equal(find(zeroAds, 'ДРР (выкупа)').number.textContent, '0,0');
  const ozon = derived({ ...rep, sales_amount: 3000, orders_amount: 4000, ads_spend: 200, wb_media_spend: 0, external_promotion_expenses: 100 });
  assert.equal(find(cards(ozon, null, 'ozon'), 'Медийная реклама'), undefined);
  assert.equal(find(cards(ozon, null, 'ozon'), 'ДРР (выкупа)').number.textContent, '10,0');
  const combined = api.combineDerived([{ derived: d, shop: { marketplace: 'wildberries' } }, { derived: ozon, shop: { marketplace: 'ozon' } }]);
  assert.equal(find(cards(combined, null, 'all'), 'ДРР (выкупа)').number.textContent, '11,9');

  const results = { monthly_reports: [rep], sku_sales: [], sku_costs: [] };
  window.supabaseClient = {
    from(table) {
      const query = { select: () => query, eq: () => query, order: () => query, limit: () => query,
        then: (resolve) => Promise.resolve({ data: results[table], error: null }).then(resolve) };
      return query;
    },
    rpc: async () => ({ data: [{ year: 2026, month: 9 }], error: null }),
  };
  const trend = await api.loadTrendData('test-shop', 0, 'wildberries');
  assert.equal(trend[0].ads, 175);
  assert.equal(trend[0].drrOrders, 8.75);
  assert.equal(trend[0].drrSales, 17.5);
  assert.equal(trend[0].profit, 495);
  const combinedTrend = api.combineTrend([trend, [{ year: 2026, month: 9, sales: 3000, orders: 4000, ads: 300, profit: 0 }]]);
  assert.equal(combinedTrend[0].drrSales, 11.875);
  assert.equal(combinedTrend[0].drrOrders, 475 / 6000 * 100);

  // Normal-motion path must keep decimal percentages instead of rounding to integers.
  const frames = [];
  window.matchMedia = () => ({ matches: false });
  context.performance = { now: () => 0 };
  context.requestAnimationFrame = (callback) => frames.push(callback);
  const animated = cards(d, prev);
  while (frames.length) frames.shift()(720);
  assert.equal(find(animated, 'ДРР (заказа)').number.textContent, '8,8');
  assert.equal(find(animated, 'ДРР (выкупа)').number.textContent, '17,5');
  console.log('PASS: DRR cards, percentage-point deltas, zero/missing bases, promo exclusion, Ozon/WB totals, trend and unchanged net profit');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
