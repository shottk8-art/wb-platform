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
        this.content = { firstChild: { html, number, events: {}, querySelector: () => number,
          addEventListener(name, handler) { this.events[name] = handler; } } };
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
function cards(d, prev = null, marketplace = 'wildberries', interaction) {
  const container = { innerHTML: '', children: [], appendChild(card) { this.children.push(card); } };
  container.active = api.renderKPI(container, d, prev, marketplace, interaction);
  container.children.active = container.active;
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
  assert.equal(trend[0].quantity, 10);
  assert.equal(trend[0].transfer, 700);
  assert.equal(trend[0].internalAds, 100);
  assert.equal(trend[0].mediaAds, 50);
  assert.equal(trend[0].promo, 999);
  const combinedTrend = api.combineTrend([trend, [{ year: 2026, month: 9, sales: 3000, orders: 4000, ads: 300, profit: 0 }]]);
  assert.equal(combinedTrend[0].drrSales, 11.875);
  assert.equal(combinedTrend[0].drrOrders, 475 / 6000 * 100);
  assert.equal(combinedTrend[0].quantity, 10);
  assert.equal(combinedTrend[0].internalAds, 100);

  let selected = '';
  const interactive = cards(d, null, 'wildberries', { activeMetric: 'drrOrders', onSelect: (key) => { selected = key; } });
  assert.equal(interactive.active, 'drrOrders');
  assert.equal(interactive.length, 9);
  for (const card of interactive) {
    assert.match(card.html, /<button /);
    assert.match(card.html, /aria-controls="trendChart"/);
    assert.doesNotMatch(card.html, /<div/);
    card.events.click();
    assert.equal(selected, card.html.match(/data-trend-metric="([^"]+)"/)[1]);
  }
  assert.equal(cards(d, null, 'ozon', { activeMetric: 'mediaAds', onSelect() {} }).active, 'sales');
  assert.equal(cards(derived({ ...rep, ads_promo_spend: 0 }), null, 'wildberries', { activeMetric: 'promo', onSelect() {} }).active, 'sales');
  assert.doesNotMatch(cards(d)[0].html, /data-trend-metric|<button/); // public storefront remains non-interactive

  let created = 0;
  let chart;
  class FakeChart {
    constructor(canvas, config) { this.canvas = canvas; this.data = config.data; this.options = config.options; chart = this; created++; }
    update(mode) { this.updatedMode = mode; }
    destroy() { this.destroyed = true; }
  }
  context.Chart = window.Chart = FakeChart;
  context.getComputedStyle = () => ({ getPropertyValue: () => '#6e6e73' });
  const canvas = { attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
  for (const metric of ['sales', 'quantity', 'transfer', 'profit', 'internalAds', 'mediaAds', 'promo', 'drrOrders', 'drrSales']) {
    api.renderTrend(canvas, trend, metric, 'wildberries');
    assert.equal(chart.data.datasets.length, 1);
    assert.equal(chart.data.datasets[0].data[0], trend[0][metric]);
    assert.equal(chart.data.datasets[0].label, api.getTrendMetric(metric, 'wildberries').label);
    assert.equal(chart.data.datasets[0].pointRadius[0], 4, 'one-month series is visible');
  }
  assert.equal(created, 1, 'metric switching updates the existing chart');
  assert.equal(chart.updatedMode, 'none');
  assert.equal(chart.options.scales.y.ticks.callback(8.75), '8,8%');
  api.renderTrend(canvas, trend, 'quantity');
  assert.equal(chart.options.scales.y.ticks.callback(10), '10 шт.');
  assert.equal(chart.options.scales.y.ticks.precision, 0);
  assert.equal(chart.options.scales.y.beginAtZero, true);
  api.renderTrend(canvas, [{ ...trend[0], drrOrders: null }], 'drrOrders');
  assert.equal(chart.data.datasets[0].data[0], null);
  assert.equal(chart.data.datasets[0].spanGaps, false);
  api.renderTrend(canvas, [
    { ...trend[0], drrOrders: null },
    { ...trend[0], drrOrders: 8.75 },
    { ...trend[0], drrOrders: null },
  ], 'drrOrders');
  assert.equal(chart.data.datasets[0].pointRadius.join(','), '0,4,0', 'isolated valid month stays visible');
  assert.match(canvas.attributes['aria-label'], /ДРР \(заказа\)/);
  assert.equal(api.getTrendMetric('internalAds', 'ozon').label, 'Продвижение Ozon');

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
