const assert=require('node:assert/strict'),fs=require('node:fs');
const css=fs.readFileSync('assets/reference.css','utf8');
for(const file of ['app.html','index.html']){
  const html=fs.readFileSync(file,'utf8');
  assert.match(html,/class="[^"]*analytics-section[^"]*"/);
  assert.match(html,/class="grid-2 analytics-grid"/);
  assert.match(html,/reference\.css\?v=20261019-center1/);
}
assert.match(css,/container:seller-analytics \/ inline-size/);
assert.match(css,/@container seller-analytics \(min-width:1100px\)/);
assert.match(css,/grid-template-columns:minmax\(460px,\.9fr\) minmax\(0,1\.2fr\)/);
assert.match(css,/@container expense-breakdown \(max-width:440px\)/);
assert.match(css,/\.analytics-section\)>\.analytics-grid\{grid-template-columns:minmax\(0,1fr\)/);
assert.doesNotMatch(css,/\.analytics-grid[^}]*order\s*:/,'visual order remains DOM order');
const products=fs.readFileSync('assets/sku-products.css','utf8');
assert.match(products,/\.sku-col-units\{width:90px\}/);
assert.match(products,/\.sku-col-revenue\{width:138px\}/);
console.log('Analytics layout PASS: shared container-aware pair, wider product column, stacked fallback, narrow expense reflow, no visual reordering.');
