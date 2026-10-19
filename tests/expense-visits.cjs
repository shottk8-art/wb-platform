const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const nodes = new Map();
const el = id => nodes.get(id) || nodes.set(id, { textContent:'', innerHTML:'', title:'' }).get(id);
const document = { getElementById:el, body:{}, documentElement:{dataset:{theme:'light'}}, activeElement:null };
const window = { matchMedia:()=>({matches:true}), WBRange:{active:false} };
const charts=[];
class Chart {
  constructor(canvas, config) { Object.assign(this,config); charts.push(this); }
  destroy() { this.destroyed=true; }
  setActiveElements(elements) { this.active=elements; }
  update(mode) { this.lastUpdate=mode; }
}
vm.runInNewContext(fs.readFileSync('assets/dashboard.js','utf8'), { window, document, Intl, Map, Date, Chart,
  getComputedStyle:()=>({getPropertyValue:key=>key==='--surface'?'#ffffff':'#f2f4f7'}) });
let buttons=[];
const list = {
  html:'',
  set innerHTML(value) {
    this.html=value;
    buttons=[...value.matchAll(/data-expense-index="(\d+)"/g)].map(match=>{
      const dot={style:{setProperty(key,val){this[key]=val;}}};
      const button={dataset:{expenseIndex:match[1]},attrs:{},dot,querySelector(){return dot;},setAttribute(key,val){this.attrs[key]=val;},
        closest(){return this;},focus(){document.activeElement=this;list.onfocusin({target:this});}};
      return button;
    });
  },
  get innerHTML(){return this.html;},
  querySelectorAll(){return buttons;},
  contains(node){return buttons.includes(node);},
};
const canvas={attrs:{},setAttribute(key,val){this.attrs[key]=val;}};
const total={textContent:''};
const draw=(expenses,previous,isApi=true)=>window.WBDashboard.renderExpenses(list,total,canvas,
  {isApi,expenses,rep:{sales_amount:2000}},'wildberries',previous?{isApi,expenses:previous,rep:{sales_amount:2000}}:null);
const clean=value=>value.replace(/[\s\u00a0\u202f]/g,'');

draw([['Товар',800],['Возмещение',-200],['Реклама',100]],[['Товар',700],['Возмещение',-100],['Реклама',150]]);
assert.equal(clean(total.textContent),'700₽','API total preserves signed corrections');
assert.equal(el('expSalesShare').textContent,'35,0%');
assert.equal(el('expCenterValue').textContent,'72,7%','ring denominator is magnitudes, not signed total');
assert.equal(el('expCenterLabel').textContent,'Товар');
assert.equal(buttons[0].attrs['aria-pressed'],'true');
assert.match(list.html,/−?200|\-200/);
assert.match(list.html,/expense-delta--up[\s\S]*−100/,'larger reimbursement is a decrease in signed expense');
assert.match(canvas.attrs['aria-label'],/абсолютных значений/);
assert.match(charts.at(-1).options.plugins.tooltip.callbacks.label({dataIndex:1,label:'Возмещение',parsed:200}),/-200/,'tooltip never turns a reimbursement into a positive cost');
buttons[1].focus();
assert.equal(el('expCenterLabel').textContent,'Возмещение');
assert.equal(el('expCenterValue').textContent,'18,2%');
assert.equal(charts.at(-1).active[0].index,1);
assert.equal(charts.at(-1).lastUpdate,'active');
list.onkeydown({key:'ArrowDown',target:buttons[1],preventDefault(){}});
assert.equal(el('expCenterLabel').textContent,'Реклама','keyboard highlights matching segment');
document.activeElement=null;list.onfocusout({relatedTarget:null});
assert.equal(el('expCenterLabel').textContent,'Товар','leaving resets to largest category');
assert.equal(charts.at(-1).options.animation,false,'reduced motion skips drawing animation');
assert.equal(charts.at(-1).options.transitions.active.animation.duration,0);
document.documentElement.dataset.theme='dark';
charts.at(-1).sellerExpenseTheme();
assert.equal(charts.at(-1).data.datasets[0].backgroundColor[0],'#7088f0');
assert.equal(buttons[0].dot.style['--expense-color'],'#7088f0','ring and legend use the measured dark palette together');
assert.equal(el('expCenterLabel').textContent,'Товар','theme repaint preserves selected category');
document.documentElement.dataset.theme='light';
charts.at(-1).sellerExpenseTheme();
assert.equal(buttons[0].dot.style['--expense-color'],'#2a45cc');

const old=charts.at(-1);
draw([['Реклама',100],['WB Media',null]],[['Реклама',null],['WB Media',50]]);
assert.ok(old.destroyed,'old chart disposed when source or period changes');
assert.equal(total.textContent,'—');
assert.match(list.html,/WB Media[\s\S]*Нет данных/);
assert.match(list.html,/от известных сумм/);
assert.doesNotMatch(list.html,/expense-delta--/,'unknown previous category must not become a zero baseline');
assert.equal(el('expHeroDelta').innerHTML,'');
assert.equal(el('expCenterLabel').textContent,'Реклама');

draw([['WB Media',null]],null);
assert.equal(total.textContent,'—');
assert.equal(el('expCenterValue').textContent,'—');
assert.equal(el('expCenterLabel').textContent,'нет данных');
assert.equal(buttons.length,0);
assert.equal(charts.at(-1).options.plugins.tooltip.enabled,false);
draw([],null);
assert.equal(clean(total.textContent),'0₽');
assert.equal(el('expCenterLabel').textContent,'нет расходов');
assert.match(list.html,/Расходов за этот период пока нет/);

draw([['Товар',800],['Возмещение',-200]],null,false);
assert.equal(clean(total.textContent),'1000₽','file-source accounting remains unchanged');
const categories=Array.from({length:14},(_,i)=>['Статья '+i,100-i]);
window.WBRange.active=true;
draw(categories,categories);
assert.equal(buttons.length,14,'all real categories remain reachable; no lossy Other bucket');
assert.equal(charts.at(-1).data.datasets[0].data.length,14);
assert.match(el('expHeroDelta').innerHTML,/к предыдущему периоду/);
list.onclick({target:buttons[13]});
assert.equal(el('expCenterLabel').textContent,'Статья 13');
assert.doesNotMatch(list.html,/exp-track/,'reference uses linked legend, not old progress tracks');
console.log('Expense Total visits: PASS (signed totals/tooltips, unknowns, comparisons, all categories, focus/click/keyboard, reduced motion, disposal).');
