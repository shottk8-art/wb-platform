const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const node = () => ({textContent:'',style:{},attrs:{},classes:new Set(),
  setAttribute(key,value){this.attrs[key]=value;},
  classList:{toggle(key,on){this.owner.classes[on?'add':'delete'](key);}}});
const ids = new Map(['profitabilityValue','profitabilityArc','profitabilityMarker','profitabilityGauge',
  'profitabilityCaption','profitabilityNote','profitabilityDelta'].map(id=>[id,node()]));
const ticks = Array.from({length:41},(_,i)=>Object.assign(node(),{dataset:{gaugeTick:String(i)}}));
for (const el of [...ids.values(),...ticks]) el.classList.owner=el;
const window = {};
vm.runInNewContext(fs.readFileSync('assets/dashboard.js','utf8'),{window,document:{
  getElementById:id=>ids.get(id),querySelectorAll:()=>ticks},Intl});
const read=id=>ids.get('profitability'+id);
const render=(margin,previous)=>window.WBDashboard.renderProfitability(
  {netProfit:margin,rep:{sales_amount:100}}, {netProfit:previous,rep:{sales_amount:100}});
render(-7.5,6.1);
assert.equal(read('Value').textContent,'-7,5');
assert.equal(read('Arc').style.strokeDashoffset,'92.5','loss magnitude must not look like zero');
assert.equal(read('Gauge').attrs['data-tone'],'loss');
assert.equal(read('Value').attrs['data-tone'],'loss');
assert.notEqual(read('Marker').attrs.cx,'40');
assert.match(read('Note').textContent,/7,5 коп\. убытка/);
assert.equal(read('Delta').textContent,'−13,6 п.п.');
assert.ok(read('Delta').classes.has('is-negative'));
render(6.1,-7.5);
assert.equal(read('Arc').style.strokeDashoffset,'93.9');
assert.equal(read('Gauge').attrs['data-tone'],'profit','no loss color leaks between periods');
assert.equal(read('Delta').textContent,'+13,6 п.п.');
assert.equal(read('Delta').classes.has('is-negative'),false);
render(0,1);
assert.equal(read('Arc').style.strokeDashoffset,'100');
assert.equal(read('Marker').attrs.visibility,'visible','known zero differs from unknown');
render(null,1);
assert.equal(read('Value').textContent,'—');
assert.equal(read('Marker').attrs.visibility,'hidden');
assert.equal(read('Arc').style.opacity,'0');
assert.ok(ticks.every(t=>!t.classes.has('is-filled')),'unknown does not fill even the zero tick');
render(-125,0);
assert.equal(read('Value').textContent,'-125,0','exact percentage is never clipped');
assert.equal(read('Arc').style.strokeDashoffset,'0','only the visual magnitude saturates');
assert.equal(read('Arc').style.opacity,'1');
console.log('Profitability gauge PASS: signed loss, truthful magnitude, zero/unknown, period reset and unclipped numeric values.');
