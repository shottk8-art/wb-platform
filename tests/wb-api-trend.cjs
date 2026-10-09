const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
let reduced = false;
const charts = [];
const window = {matchMedia:()=>({matches:reduced})};
class Chart {
  constructor(canvas,config) { this.canvas=canvas; this.data=config.data; this.options=config.options; charts.push(this); }
  update(mode) { this.mode=mode; }
}
vm.runInNewContext(fs.readFileSync('assets/dashboard.js','utf8'),{window,document:{body:{}},getComputedStyle:()=>({getPropertyValue:()=> '#6e6e73'}),Chart,Intl,console});
const canvas = {setAttribute(){}};
window.WBDashboard.renderTrend(canvas,[], 'profit','wildberries');
window.WBDashboard.renderTrend(canvas,[{year:2026,month:9,profit:'792508.25'}], 'profit','wildberries');
assert.equal(charts.length,1);
assert.equal(charts[0].data.datasets[0].data[0],792508.25);
assert.equal(charts[0].data.datasets[0].pointRadius,5,'single value has explicit non-indexed visible radius');
assert.equal(charts[0].data.datasets[0].pointStyle,'circle');
window.WBDashboard.renderTrend({setAttribute(){}},[{year:2026,month:9,sales:10}], 'sales','wildberries');
assert.equal(charts.length,2,'API and file canvases retain separate instances');
reduced=true;
window.WBDashboard.renderTrend(canvas,[{year:2026,month:9,profit:0},{year:2026,month:10,profit:null},{year:2026,month:11,profit:'bad'}], 'profit','wildberries');
assert.equal(charts[0].data.datasets[0].data[0],0);
assert.equal(charts[0].data.datasets[0].data[1],null);
assert.equal(charts[0].data.datasets[0].data[2],null);
assert.equal(charts[0].mode,'none');
console.log('API trend: numeric strings, single-point marker, canvas isolation, missing values and reduced motion passed.');
