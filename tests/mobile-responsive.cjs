const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
let chart;
const window = {matchMedia: () => ({matches: true})};
const document = {getElementById: () => null, body: {}};
vm.runInNewContext(fs.readFileSync(path.join(root,'assets/dashboard.js'),'utf8'), {
  window, document, Intl, Map, Date,
  getComputedStyle: () => ({getPropertyValue: () => '#187a32'}),
  Chart: function(canvas, options) { chart = options; this.destroy = () => {}; },
});
const body = {}, foot = {}, hint = {};
const product = {article:'a-very-long-article-identifier',name:'Длинное название товара',abc:'A',bought_qty:854,revenue:1182101,total_cost:339892,cost_price:398,profit:842209};
const d = {skuRows:[product]};
window.WBDashboard.renderSkuTable(body,foot,hint,{clientWidth:290},d,{skuRows:[{...product,bought_qty:822,revenue:1228788,profit:901632}]});
for (const label of ['Выкупили, шт.', 'Выручка, ₽', 'Себестоимость, ₽', 'Валовая прибыль, ₽']) {
  assert.ok(body.innerHTML.includes(`data-label="${label}"`));
  assert.ok(foot.innerHTML.includes(`data-label="${label}"`));
}
assert.ok(body.innerHTML.includes('1 182 101'), 'actual sales remain exact, not abbreviated to fit');
assert.ok(body.innerHTML.includes('sku-delta'), 'previous-month comparison is retained');
assert.ok(body.innerHTML.includes('qty-track" aria-hidden="true"'), 'decorative bar is not a second announced metric');
const tick = chart.options.scales.y.ticks.callback.call({getLabelForValue:()=>product.article},0);
assert.equal(tick.length,17,'narrow chart labels have a bounded width');
assert.ok(tick.endsWith('…'));
window.WBDashboard.renderSkuTable(body,foot,hint,{clientWidth:290},{skuRows:[]},null);
assert.ok(body.innerHTML.includes('colspan="5"'));
assert.equal(foot.innerHTML,'');
for (const page of ['app.html','index.html','admin.html']) {
  const html = fs.readFileSync(path.join(root,page),'utf8');
  assert.ok(html.includes('/assets/responsive.css?v=20261010-mobile1'),`${page}: shared responsive styles`);
  assert.ok(html.includes('viewport-fit=cover'),`${page}: safe-area support`);
}
console.log('Mobile renderer regression: PASS (labels, totals, comparisons, long chart labels, empty state, shared surfaces).');
