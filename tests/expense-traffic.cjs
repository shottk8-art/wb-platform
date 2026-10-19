const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let reduce=false,clock=0,nextFrame=0;const frames=new Map(),animations=[];
class Element {
  constructor(name='div'){this.name=name;this.children=[];this.attrs={};this.dataset={};this.style={setProperty(k,v){this[k]=v}};this.textContent='';this.hidden=false;const classes=new Set();this.classList={add:k=>classes.add(k),remove:k=>classes.delete(k),toggle:(k,on)=>on?classes.add(k):classes.delete(k),contains:k=>classes.has(k)};}
  append(child){child.parentElement=this;this.children.push(child);}
  after(child){child.parentElement=this.parentElement;this.parentElement.children.splice(this.parentElement.children.indexOf(this)+1,0,child);}
  remove(){this.removed=true;if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(c=>c!==this);}
  setAttribute(k,v){this.attrs[k]=v;if(k==='data-expense-index')this.dataset.expenseIndex=v;if(k==='data-expense-segment')this.dataset.expenseSegment=v;}
  getAttribute(k){return this.attrs[k];}
  contains(node){return node===this||this.children.some(c=>c.contains(node));}
  closest(selector){const attr=selector.slice(1,-1);return this.attrs[attr]!=null?this:this.parentElement?.closest(selector)||null;}
  querySelector(){return this.dot;}
  querySelectorAll(){return this.buttons||[];}
  addEventListener(name,fn){(this.events||={})[name]=fn;}
  removeEventListener(name,fn){if(this.events?.[name]===fn)delete this.events[name];}
  focus(){document.activeElement=this;this.parentElement.events?.focusin?.({target:this});}
  scrollIntoView(){this.scrolled=true;}
  animate(keys,options){const animation={keys,options,cancelled:false,cancel(){this.cancelled=true}};animations.push(animation);return animation;}
}
const document={hidden:false,activeElement:null,events:{},createElementNS:(_,name)=>new Element(name),addEventListener(name,fn){this.events[name]=fn}};
const window={events:{},matchMedia:()=>({matches:reduce,addEventListener(name,fn){window.preference=fn}}),addEventListener(name,fn){this.events[name]=fn}};
vm.runInNewContext(fs.readFileSync('assets/expense-traffic.js','utf8'),{window,document,Intl,Map,Set,WeakMap,Number,Math,performance:{now:()=>clock},requestAnimationFrame:fn=>{frames.set(++nextFrame,fn);return nextFrame},cancelAnimationFrame:id=>frames.delete(id)});
const api=window.WBExpenseTraffic;
const tiny=api.geometry([{value:100},{value:.00001}],100.00001);assert.ok(tiny[1].dash>0,'small categories are not swallowed by a fixed gap');
assert.equal(api.formatPercent(.0001),'<0,1%');assert.equal(api.formatPercent(35),'35%');
const parts=api.geometry([{value:800},{value:-200},{value:100}],1100);assert.ok(Math.abs(parts[1].share-200/1100*100)<1e-9);assert.ok(parts[1].offset<0);
const card=new Element(),chartParent=new Element(),canvas=new Element('canvas'),list=new Element(),centerValue=new Element('strong'),centerLabel=new Element('span');chartParent.append(canvas);canvas.closest=()=>card;canvas.setAttribute('aria-label','Известные суммы по модулю');
let dark=false;
const items=[{label:'Товар',value:800},{label:'Возмещение',value:-200},{label:'Реклама',value:100}];
function buttonsFor(rows){list.children=[];list.buttons=rows.map((r,i)=>{const b=new Element('button');b.dot=new Element('i');b.setAttribute('data-expense-index',String(i));list.append(b);return b;});return list.buttons;}
let buttons=buttonsFor(items);
const options={canvas,listEl:list,centerValue,centerLabel,items,chartTotal:1100,total:700,totalText:'700 ₽',unknownItems:[],paletteForTheme:()=>dark?['#7088f0','#b1bdf5','#5cc0a6']:['#2a45cc','#93a3ec','#3f9c86']};
assert.equal(api.render(options),true);let svg=chartParent.children[1];
assert.equal(centerValue.textContent,'700 ₽','rest shows signed expense total, not magnitude sum or largest category');assert.equal(centerLabel.textContent,'расходы');assert.equal(canvas.hidden,true);assert.ok(card.classList.contains('is-traffic'));assert.equal(svg.children[1].children.length,3);assert.equal(animations.length,3,'bounded reveal, one animation per segment');
list.onpointerover({target:buttons[0]});assert.equal(centerValue.textContent,'72,7%');assert.equal(centerLabel.textContent,'Товар');assert.equal(frames.size,0,'money never interpolates into a nonsensical percentage');assert.ok(svg.classList.contains('has-selection'));assert.equal(buttons[0].attrs['aria-pressed'],'true');assert.ok(svg.children[1].children[0].classList.contains('is-selected'));
list.onpointerover({target:buttons[1]});assert.equal(frames.size,1);
function tick(time){clock=time;const batch=[...frames.values()];frames.clear();batch.forEach(fn=>fn(time));}
tick(120);const during=parseFloat(centerValue.textContent.replace(',','.'));assert.ok(during>18.2&&during<72.7,'percentage-to-percentage values really animate');
list.onpointerover({target:buttons[2]});assert.equal(frames.size,1,'rapid movement keeps only latest counter');tick(600);assert.equal(centerValue.textContent,'9,1%');assert.equal(frames.size,0);
list.onpointerout({target:buttons[2],relatedTarget:buttons[2]});assert.equal(centerValue.textContent,'9,1%');
list.onpointerout({target:buttons[2],relatedTarget:null});assert.equal(centerValue.textContent,'700 ₽');assert.equal(svg.classList.contains('has-selection'),false,'leaving restores total and every segment');
buttons[1].focus();list.onkeydown({target:buttons[1],key:'End',preventDefault(){}});assert.equal(buttons[2].attrs['aria-pressed'],'true');
list.onkeydown({target:buttons[2],key:'Home',preventDefault(){}});assert.equal(buttons[0].attrs['aria-pressed'],'true');
list.onkeydown({target:buttons[0],key:'Escape',preventDefault(){}});assert.equal(centerValue.textContent,'700 ₽');
svg.onclick({target:svg.children[1].children[1]});assert.equal(buttons[1].attrs['aria-pressed'],'true');assert.ok(buttons[1].scrolled,'ring selection reaches its legend row');
dark=true;window.events['seller:themechange']();assert.equal(buttons[0].dot.style['--expense-color'],'#7088f0');assert.equal(buttons[1].attrs['aria-pressed'],'true','theme keeps selected category');
list.events.focusout({relatedTarget:null});assert.equal(centerValue.textContent,'700 ₽');
list.onpointerover({target:buttons[0]});list.onpointerover({target:buttons[1]});assert.equal(frames.size,1);
const oldSvg=svg,oldAnimations=animations.slice();buttons=buttonsFor(items.slice(0,1));
api.render({...options,items:items.slice(0,1),chartTotal:800,total:null,totalText:'—',unknownItems:[['WB Media',null]]});
svg=chartParent.children[1];assert.ok(oldSvg.removed);assert.equal(chartParent.children.length,2,'source replacement reuses one SVG slot');assert.equal(frames.size,0);assert.ok(oldAnimations.every(a=>a.cancelled));assert.equal(centerValue.textContent,'—');assert.equal(centerLabel.textContent,'нет данных');
list.onpointerover({target:buttons[0]});assert.equal(centerValue.textContent,'100%','known amount still has an explicit known-magnitude share');
reduce=true;window.preference();assert.equal(frames.size,0);const count=animations.length;
buttons=buttonsFor(items);api.render(options);list.onpointerover({target:buttons[0]});list.onpointerover({target:buttons[1]});assert.equal(centerValue.textContent,'18,2%');assert.equal(frames.size,0);assert.equal(animations.length,count,'reduced motion adds no draw or text animation');
document.hidden=true;document.events.visibilitychange();assert.equal(centerValue.textContent,'700 ₽');assert.equal(frames.size,0);document.hidden=false;
buttonsFor([]);api.render({...options,items:[],chartTotal:0,total:0,totalText:'0 ₽'});assert.equal(centerValue.textContent,'0 ₽');assert.equal(centerLabel.textContent,'нет расходов');assert.equal(chartParent.children[1].children[1].children.length,0);
api.dispose(canvas);assert.equal(canvas.hidden,false);assert.equal(chartParent.children.length,1);assert.equal(list.onpointerover,null);assert.equal(list.events.focusin,undefined);assert.equal(list.events.focusout,undefined);assert.equal(card.classList.contains('is-traffic'),false);
console.log('Expense Traffic PASS: real signed rest total, magnitude shares/tiny segments, linked rows/ring, leave reset, keyboard/touch, interrupted counters, no cross-unit interpolation, theme/reduced/hidden states, replacement/disposal; no services.');
