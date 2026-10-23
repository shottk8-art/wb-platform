const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const app = fs.readFileSync('app.html', 'utf8');
const block = app.slice(app.indexOf('  function refreshTrendChart()'), app.indexOf('  function setOverviewPending('));
const listener = app.match(/document\.addEventListener\('click', event => \{\s*if \(event\.target\.closest\?\.\('#profitabilityTrend'\)\) selectTrendMetric\('profitability'\);\s*\}\);/);
assert.ok(listener, 'delegate navigation so a gauge mounted after async init still works');
const node = () => ({ attrs: {}, dataset: {}, children: [], style: {}, classList: { toggle() {} },
  setAttribute(k, v) { this.attrs[k] = v; }, append(...children) { this.children.push(...children); },
  replaceChildren(...children) { this.children = children; }, scrollIntoView() {} });
const nodes = new Map(['trendHint','trendLegend','trendEmpty','trendChart','trendValues','secTrend'].map(id=>[id,node()]));
const handlers = {};
const document = { body: {}, getElementById: id=>nodes.get(id), createElement:node, createTextNode:text=>({text}),
  querySelectorAll:()=>[nodes.get('profitabilityTrend')].filter(Boolean), addEventListener:(name,fn)=>handlers[name]=fn };
const window = { matchMedia:()=>({matches:true}) };
const context = vm.createContext({ window, document, Intl, Map, Date, getComputedStyle:()=>({getPropertyValue:()=>''}) });
vm.runInContext(fs.readFileSync('assets/dashboard.js', 'utf8'), context);
let plotted;
window.WBDashboard.renderTrend = (canvas,rows,metric) => { plotted = metric; };
vm.runInContext(`let trendMetric='sales',overviewScope='wildberries',currentTrend=[{year:2026,month:8,sales:100,profit:null},{year:2026,month:9,sales:900,profit:180}];${block}\n${listener[0]}`, context);
// Deliberately mount the gauge after wiring, just like a fast account init.
const button = node(); button.dataset.trendMetric = 'profitability'; nodes.set('profitabilityTrend',button);
handlers.click({target:{closest:()=>button}});
assert.equal(plotted,'profitability'); assert.equal(button.attrs['aria-pressed'],'true');
assert.equal(nodes.get('trendEmpty').hidden,true);
assert.match(nodes.get('trendValues').textContent,/август 2026: нет данных; сентябрь 2026: 20 %/);
assert.equal(nodes.get('trendChart').attrs['aria-label'],'Рентабельность: динамика магазина');
vm.runInContext("selectTrendMetric('sales')",context);
assert.equal(button.attrs['aria-pressed'],'false');
vm.runInContext("currentTrend=[{year:2026,month:8,sales:100,profit:null}];selectTrendMetric('profitability')",context);
assert.equal(nodes.get('trendEmpty').hidden,false);
console.log('Profitability navigation: PASS (late gauge mount, actual app selection, accessible descriptions and unavailable months).');
