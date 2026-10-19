const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
let reduce=false,clock=0,rafId=0,writes=0;
const frames=new Map();
class Element {
  constructor(tag='div') {
    this.tagName=tag;this.children=[];this.attrs={};this.dataset={};this.events={};this.hidden=false;this._text='';
    this.style={setProperty(key,value){this[key]=value;}};
    const classes=new Set();this.classList={add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle:(x,on)=>{if(on)classes.add(x);else classes.delete(x);}};
  }
  set textContent(value){writes++;this._text=value;}
  get textContent(){return this._text;}
  set innerHTML(value){this.html=value;this.selectors=new Map();for(const name of ['.trend-months','.trend-highlight','.trend-highlight-cap','.trend-tooltip','.trend-average','.trend-tooltip-month','.trend-tooltip-metric','.trend-tooltip-secondary','.trend-tooltip-comparison','[data-tip-value]','[data-tip-secondary]','[data-tip-delta]'])this.selectors.set(name,new Element());this.selectors.get('.trend-average').selectors=new Map([['span',new Element()]]);this.selectors.get('.trend-tooltip').selectors=this.selectors;}
  querySelector(selector){return this.selectors?.get(selector)||null;}
  append(child){this.children.push(child);child.parentElement=this;}
  replaceChildren(){this.children=[];}
  remove(){this.removed=true;}
  setAttribute(name,value){this.attrs[name]=value;}
  addEventListener(name,handler){this.events[name]=handler;}
  removeEventListener(name,handler){if(this.events[name]===handler)delete this.events[name];}
  contains(el){return this.children.includes(el);}
  closest(selector){return selector==='[data-trend-index]' && this.dataset.trendIndex!=null?this:null;}
  focus(){this.parentElement?.events.focusin?.({target:this});}
  get offsetWidth(){return 230;}
}
const heading=new Element(),parent=new Element(),canvas=new Element('canvas');
parent.append(canvas);canvas.closest=()=>({querySelector:()=>heading});
const selected={value:'2026-9'};
const document={hidden:false,events:{},createElement:tag=>new Element(tag),getElementById:()=>selected,addEventListener(name,handler){this.events[name]=handler;}};
const metrics={sales:{label:'Сумма продаж',unit:'₽',color:'#2a45cc'},quantity:{label:'Выкупили',unit:'шт.',color:'#aabbcc'},drrOrders:{label:'ДРР (заказа)',unit:'%',color:'#2a45cc'},drrSales:{label:'ДРР (выкупа)',unit:'%',color:'#2a45cc'},internalAds:{label:'Внутренняя реклама',unit:'₽',color:'#2a45cc'},promo:{label:'Промобонусы',unit:'₽',color:'#2a45cc'}};
const window={matchMedia:()=>({matches:reduce,addEventListener(){}}),WBDashboard:{getTrendMetric:key=>({...metrics[key]})}};
vm.runInNewContext(fs.readFileSync('assets/trend-interaction.js','utf8'),{window,document,Intl,Date,Map,Set,WeakMap,Number,Math,performance:{now:()=>clock},requestAnimationFrame:cb=>{frames.set(++rafId,cb);return rafId;},cancelAnimationFrame:id=>frames.delete(id)});
const {model,numeric,plugin}=window.WBTrend;
const now=new Date(2030,0,1);
const make=(rows,key='sales',selection='')=>model(rows,key,metrics[key],selection,now);
const clean=value=>value.replace(/[\s\u00a0\u202f]/g,'');
for(const value of [null,undefined,'',false,true,NaN,Infinity,'abc'])assert.equal(numeric(value),null);
assert.equal(numeric('0'),0);assert.equal(numeric(-10),-10);
const rows=[{year:2025,month:12,sales:100,quantity:5,orders:200,drrOrders:10},{year:2026,month:1,sales:200,quantity:8,orders:1000,drrOrders:20}];
let m=make(rows);
assert.equal(m.summary,300);assert.equal(m.average,150);assert.equal(m.detail(1).delta,100);
assert.equal(m.detail(1).secondary,8);assert.equal(m.detail(1).month,'январь 2026');
assert.equal(make(rows,'quantity').detail(1).secondary,200);
assert.equal(make(rows,'quantity').detail(1).secondaryLabel,'Сумма продаж');
assert.equal(make([{...rows[0],month:11},rows[1]]).detail(1).delta,null,'never bridge calendar gaps');
assert.equal(make([{...rows[0],sales:0},rows[1]]).detail(1).delta,null,'no percent against a zero base');
assert.equal(make([{...rows[0],sales:null},rows[1]]).summary,null,'summary does not hide missing months');
assert.equal(make([{...rows[0],sales:null},rows[1]]).average,200,'known-month average is explicit');
assert.equal(make([{...rows[0],sales:-100},{...rows[1],sales:0}]).detail(1).delta,100);
assert.equal(make([{...rows[0],sales:null},{...rows[1],sales:null}]).average,null);
m=make(rows,'drrOrders');assert.equal(m.detail(1).delta,10);assert.match(m.detail(1).deltaText,/п.п./);
assert.ok(Math.abs(m.summary-(10*200+20*1000)/1200)<1e-9,'rate guide is denominator-weighted');
assert.notEqual(m.summary,15,'not arithmetic average of rates');
assert.equal(make([{...rows[0],orders:0},rows[1]],'drrOrders').summary,null);
assert.equal(make([{...rows[0],orders:null},rows[1]],'drrOrders').summary,null);
assert.equal(make(rows,'sales','2025-12').initial,0);
const partial=model(rows,'sales',metrics.sales,'',new Date(2026,0,12)).detail(1);
assert.equal(partial.delta,null);assert.equal(partial.comparisonLabel,'Месяц не закрыт');
assert.equal(make(rows.map((r,i)=>({...r,internalAds:100+i*100})),'internalAds').detail(1).sentiment,'down');
assert.equal(make(rows.map((r,i)=>({...r,promo:100+i*100})),'promo').detail(1).sentiment,'neutral');

const series=[{year:2026,month:8,sales:100,quantity:5},{year:2026,month:9,sales:200,quantity:10}];
const chart={canvas,width:600,height:250,config:{type:'bar'},chartArea:{left:50,right:590,top:10,bottom:220},data:{datasets:[{sellerRows:series,sellerMetric:'sales'}]},scales:{x:{getPixelForValue:i=>185+i*270},y:{min:0,max:200,getPixelForValue:value=>220-value}}};
plugin.afterUpdate(chart);assert.equal(parent.children.length,2,'mounted exactly once');
const root=parent.children[1],plot=root.querySelector('.trend-months'),tip=root.querySelector('.trend-tooltip'),mark=root.querySelector('.trend-highlight');
const value=()=>root.querySelector('[data-tip-value]').textContent;
assert.equal(clean(value()),'200₽');assert.equal(plot.children[1].attrs['aria-pressed'],'true');
assert.equal(tip.hidden,true,'tooltip is hidden until the chart is inspected');
assert.match(mark.style.transform,/translate\(440px,20px\)/);
let before=writes;for(let i=0;i<40;i++)plugin.afterDraw(chart);assert.equal(writes,before,'no DOM work per canvas animation frame');
plot.events.pointermove({target:plot.children[0]});assert.equal(frames.size,1);
assert.equal(tip.hidden,false,'hover reveals the tooltip');
assert.equal(plot.children[0].attrs['aria-pressed'],'true');
function tick(time){clock=time;const batch=[...frames.values()];frames.clear();batch.forEach(cb=>cb(time));}
tick(150);assert.ok(parseInt(clean(value()))>100 && parseInt(clean(value()))<200,'values genuinely interpolate');
plot.events.pointermove({target:plot.children[1]});assert.equal(frames.size,1,'rapid hover cancels previous numeric loop');
tick(600);assert.equal(clean(value()),'200₽');assert.equal(frames.size,0);
plot.events.pointermove({target:plot.children[0]});parent.events.pointerleave();
assert.equal(tip.hidden,true,'leaving the whole chart hides the tooltip immediately');
assert.equal(frames.size,0,'leaving cancels invisible number animation');tick(1100);
assert.equal(plot.children[1].attrs['aria-pressed'],'true','pointer leave restores selected month');
plot.events.pointermove({target:plot.children[1]});assert.equal(tip.hidden,false,'re-entering the same selected month reveals it again');assert.equal(clean(value()),'200₽');
plot.events.focusout({relatedTarget:null});assert.equal(tip.hidden,true,'tabbing out hides the tooltip');
reduce=true;plot.events.pointermove({target:plot.children[0]});assert.equal(frames.size,0);assert.equal(clean(value()),'100₽');assert.ok(root.classList.contains('is-instant'));
plot.events.keydown({target:plot.children[0],key:'End',preventDefault(){}});assert.equal(plot.children[1].attrs['aria-pressed'],'true');
plot.events.keydown({target:plot.children[1],key:'ArrowLeft',preventDefault(){}});assert.equal(plot.children[0].attrs['aria-pressed'],'true');
plot.events.keydown({target:plot.children[0],key:'Escape',preventDefault(){}});assert.equal(plot.children[1].attrs['aria-pressed'],'true');
assert.equal(tip.hidden,true,'Escape dismisses even after focus restores the selected month');
plot.events.click({target:plot.children[1]});assert.equal(tip.hidden,false,'tap/click still opens the card');
plot.events.pointercancel();assert.equal(tip.hidden,true,'cancelled touch hides the card');
reduce=false;plot.events.pointermove({target:plot.children[0]});assert.equal(frames.size,1);
chart.data.datasets[0].sellerRows=series.map(r=>({...r,sales:null}));plugin.afterUpdate(chart);assert.equal(frames.size,0);assert.equal(value(),'—');assert.equal(mark.hidden,true);
assert.equal(tip.hidden,true,'source replacement cannot reopen a stale card');
chart.data.datasets[0].sellerRows=series;chart.data.datasets[0].sellerMetric='quantity';plugin.afterUpdate(chart);assert.equal(clean(value()),'10шт.');
chart.config.type='line';chart.scales.x.getPixelForValue=i=>50+i*540;plugin.afterUpdate(chart);
assert.ok(mark.classList.contains('is-point'));assert.equal(plot.children[1].style['--month-x'],'270px');
chart.chartArea.right=chart.chartArea.left;plugin.afterUpdate(chart);assert.equal(root.hidden,true);
chart.chartArea.right=590;plugin.afterUpdate(chart);assert.equal(root.hidden,false);assert.equal(clean(value()),'10шт.','same chart recovers after its route was hidden');
chart.data.datasets[0]={...chart.data.datasets[0],sellerMetric:'sales'};series[1].sales=350;plugin.afterUpdate(chart);
assert.equal(clean(value()),'350₽','new render refreshes even when the source array was reused');
metrics.sales.color='#7088f0';plugin.afterUpdate(chart);assert.equal(root.style['--trend-color'],'#7088f0');
assert.equal(plot.children[1].attrs['aria-pressed'],'true','theme refresh preserves selected month');
chart.data.datasets[0].sellerRows=[];plugin.afterUpdate(chart);assert.equal(root.hidden,true);assert.equal(heading.children[0].textContent,'');
plugin.afterDestroy(chart);assert.ok(root.removed);assert.ok(heading.children[0].removed);assert.equal(frames.size,0);
assert.equal(parent.events.pointerleave,undefined,'chart disposal removes its parent listener');
assert.equal(parent.classList.contains('has-trend-interaction'),false);
const emptyChart={...chart,data:{datasets:[{sellerRows:[],sellerMetric:'sales'}]}};
plugin.afterUpdate(emptyChart);document.hidden=true;
assert.doesNotThrow(()=>document.events.visibilitychange(),'an initially empty dashboard is safe when the tab is hidden');
plugin.afterDestroy(emptyChart);document.hidden=false;
console.log('Trend interaction PASS: real values, exact calendar comparison, weighted rates, partial/null/negative/zero, hover/keyboard/reset, interrupted bounded animation, reduced motion, reuse/disposal, zero per-frame DOM work.');
