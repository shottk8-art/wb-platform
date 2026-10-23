const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const charts = [];
const window = { matchMedia: () => ({ matches: true }) };
const document = { body: {}, addEventListener() {} };
class Chart {
  constructor(canvas, config) { Object.assign(this, config, { canvas }); charts.push(this); }
  update() {}
}
const context = vm.createContext({ window, document, Chart, Intl, Date, Map, Set, WeakMap,
  getComputedStyle: () => ({ getPropertyValue: () => '#187a32' }) });
vm.runInContext(fs.readFileSync('assets/dashboard.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('assets/trend-interaction.js', 'utf8'), context);
const api = window.WBDashboard;
const metric = api.getTrendMetric('profitability', 'wildberries');
assert.equal(metric.label, 'Рентабельность');
assert.equal(metric.unit, '%');
const rows = [
  { year: 2026, month: 8, sales: 100, profit: -10 },
  { year: 2026, month: 9, sales: 900, profit: 180 },
];
const model = input => window.WBTrend.model(input, 'profitability', metric, '', new Date(2030, 0, 1));
assert.equal(api.trendMetricValue(rows[0], 'profitability'), -10);
assert.equal(api.trendMetricValue({ sales: '100', profit: '120' }, 'profitability'), 120);
for (const profit of [null, undefined, '', false, Infinity])
  assert.equal(api.trendMetricValue({ sales: 100, profit }, 'profitability'), null);
assert.equal(api.trendMetricValue({ sales: 0, profit: 0 }, 'profitability'), null);
assert.equal(api.trendMetricValue({ sales: 100, profit: 0 }, 'profitability'), 0);
assert.equal(model(rows).summary, 17, 'period uses total profit / total sales, not mean margins');
assert.equal(model(rows).detail(1).delta, 30);
assert.equal(model(rows).detail(1).sentiment, 'up');
assert.match(model(rows).detail(1).deltaText, /п.п\./);
assert.equal(model([{ ...rows[0], profit: null }, rows[1]]).summary, null);
assert.equal(model([{ ...rows[0], month: 7 }, rows[1]]).detail(1).delta, null);
assert.equal(window.WBTrend.model(rows, 'profitability', metric, '', new Date(2026, 8, 15)).detail(1).delta, null);
api.renderTrend({ setAttribute() {} }, [...rows, { year: 2026, month: 10, sales: 100, profit: null }], 'profitability');
assert.deepEqual(Array.from(charts[0].data.datasets[0].data), [-10, 20, null]);
assert.equal(charts[0].data.datasets[0].spanGaps, false);
assert.match(charts[0].options.scales.y.ticks.callback(20), /%/);
const source = fs.readFileSync('assets/corbel-components.js', 'utf8');
assert.match(source, /id="profitabilityHelp"[^>]*type="button"/);
assert.match(source, /id="profitabilityHelpText"[^>]*role="tooltip"/);
assert.match(source, /id="profitabilityTrend"[^>]*data-trend-metric="profitability"/);
console.log('Profitability trend: PASS (weighted ratios, missing/negative values, pp comparisons, chart and accessible controls).');
