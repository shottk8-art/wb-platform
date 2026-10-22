const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {build}=require('../assets/demo-data.js'),{buildSeries}=require('../assets/welcome-preview.js');
const window={addEventListener(){}},context=vm.createContext({window,Intl,Map,Set,Date});
vm.runInContext(fs.readFileSync('assets/dashboard.js','utf8'),context);
const sample=build(new Date('2026-10-21T12:00:00Z')),series=buildSeries(sample,window.WBDashboard);
assert.equal(series.length,6);assert.equal(series[0].month,4);assert.equal(series.at(-1).month,9);
series.forEach((row,i)=>{
  const expected=['wildberries','ozon'].map(m=>sample.data[m][i+6]);
  assert.equal(row.sales,expected.reduce((sum,r)=>sum+r.report.sales_amount,0));
  assert.equal(row.sales,row.profit+row.expenses);
  assert(row.profit>0&&row.expenses>0);
});
const source=fs.readFileSync('assets/welcome-preview.js','utf8');
assert(!/fetch\(|\.from\(|supabase|localStorage|sessionStorage/.test(source),'preview cannot read a seller account or call a service');
for(const marker of ['Демо-данные','onpointerenter','onfocus','ArrowRight','Escape','prefers-reduced-motion','visibilitychange','dispose()'])assert(source.includes(marker));
assert(source.includes("$('[data-preview-name]').textContent=name"),'user-supplied name is text, not HTML');
for(const file of ['index.html','app.html']){
  const html=fs.readFileSync(file,'utf8');assert(html.includes('/assets/welcome-preview.js?'));assert(html.includes('/assets/demo-data.js?'));
}
console.log('Welcome preview: PASS (coherent six-month synthetic data, no services/storage, named demo, keyboard, cleanup and reduced motion).');

// Exercise the actual preview controller with a tiny DOM adapter; no browser prefs are changed.
function fixture(reduce=false){
  const animations=[],documentEvents=new Map(),mediaEvents=new Map();
  const element=()=>({textContent:'',hidden:false,dataset:{},attrs:{},events:new Map(),
    style:{setProperty(){}},classList:{toggle(){}},
    setAttribute(k,v){this.attrs[k]=v;},
    addEventListener(k,fn){this.events.set(k,fn);},removeEventListener(k){this.events.delete(k);},
    animate(){let finish;const a={finished:new Promise(resolve=>finish=resolve),cancel(){this.cancelled=true;finish();}};animations.push(a);return a;},
  });
  const nodes=new Map(),get=s=>{if(!nodes.has(s))nodes.set(s,element());return nodes.get(s);};
  const metrics=['sales','expenses','profit'].map(id=>{const b=element(),value=element(),number=element(),unit=element();b.dataset.previewMetric=id;value.querySelector=s=>s==='span'?number:unit;b.querySelector=()=>value;return b;});
  const months=Array.from({length:6},()=>{const b=element(),fill=element();b.querySelector=()=>fill;b.focus=()=>b.onfocus?.();return b;});
  const chart=get('.welcome-chart');chart.contains=node=>months.includes(node);
  const root=element();root.querySelector=get;root.querySelectorAll=s=>s==='[data-preview-metric]'?metrics:months;
  const document={hidden:false,addEventListener:(k,fn)=>documentEvents.set(k,fn),removeEventListener:k=>documentEvents.delete(k)};
  const media={matches:reduce,addEventListener:(k,fn)=>mediaEvents.set(k,fn),removeEventListener:k=>mediaEvents.delete(k)};
  const state={window:{WBDemoData:{build:()=>sample},WBDashboard:window.WBDashboard,matchMedia:()=>media},document,Intl,Date,Promise};
  vm.createContext(state);vm.runInContext(source,state);
  const controller=state.window.WBWelcomePreview.mount(root);
  return{controller,root,get,metrics,months,chart,document,documentEvents,media,mediaEvents,animations};
}
const normal=fixture();assert.equal(normal.animations.length,6,'one bounded reveal per month');
normal.controller.setName('<img src=x>');assert.equal(normal.get('[data-preview-name]').textContent,'<img src=x>');
normal.metrics[0].onclick();assert.equal(normal.get('[data-preview-title]').textContent,'Продажи');
normal.months[2].onpointerenter();assert.equal(normal.get('.welcome-chart-tooltip').hidden,false);
normal.months[2].onkeydown({key:'Escape',preventDefault(){}});assert.equal(normal.get('.welcome-chart-tooltip').hidden,true);
normal.months[2].onkeydown({key:'ArrowRight',preventDefault(){}});assert.equal(normal.months[3].attrs['aria-pressed'],'true');
normal.chart.events.get('pointerleave')();assert.equal(normal.get('.welcome-chart-tooltip').hidden,true);
normal.document.hidden=true;normal.documentEvents.get('visibilitychange')();assert(normal.animations.every(a=>a.cancelled));
normal.controller.dispose();assert.equal(normal.documentEvents.size,0);assert.equal(normal.mediaEvents.size,0);assert.equal(normal.chart.events.size,0);
const reduced=fixture(true);assert.equal(reduced.animations.length,0);reduced.metrics[1].onclick();reduced.months[0].onfocus();assert.equal(reduced.animations.length,0);assert.equal(reduced.get('.welcome-chart-tooltip').hidden,false,'reduced motion retains readable feedback');reduced.controller.dispose();
console.log('Welcome motion: PASS (linked metric/month state, Escape/leave, keyboard, hidden-document cancel, disposal, reduced-motion feedback).');
