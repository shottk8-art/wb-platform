const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const classes=()=>{const set=new Set();return{add:x=>set.add(x),toggle:(x,on)=>on?set.add(x):set.delete(x),contains:x=>set.has(x)}};
let enhanced=0,chartCount=0;
const search={value:''},sort={value:''},filterButtons=['all','A','B','C'].map(abc=>({dataset:{abc},classList:classes(),setAttribute(){}}));
const controls={skuSearch:search,skuSort:sort,skuAbcFilters:{querySelectorAll:()=>filterButtons}};
const card={classList:classes()},tbody={closest:()=>card},tfoot={},hint={},chartWrap={hidden:false},canvas={closest:()=>chartWrap};
const window={matchMedia:()=>({matches:true}),WBSkuProducts:{enhance:c=>{assert.equal(c,card);enhanced++;}}};
const document={body:{},getElementById:id=>controls[id]||null};
vm.runInNewContext(fs.readFileSync('assets/dashboard.js','utf8'),{window,document,Intl,Map,Date,getComputedStyle:()=>({getPropertyValue:()=> '#2a45cc'}),Chart:function(){chartCount++;}});
const row=(article,revenue,abc='A')=>({article,name:article,abc,revenue,bought_qty:10,cost_price:2,total_cost:20,profit:revenue==null?null:revenue-20});
const rows=[row('LEADER',1000),row('Half',500,'B'),row('Negative',-50),row('Zero',0),row('Unknown',null),row('<script>alert(1)</script>',10),row('Tiny',.01)];
const prev={skuRows:rows.map(s=>({...s,article:s.article.toLowerCase(),bought_qty:9,revenue:s.revenue==null?null:s.revenue-1}))};
const original=JSON.stringify(rows),render=()=>window.WBDashboard.renderSkuTable(tbody,tfoot,hint,canvas,{skuRows:rows},prev);
render();
assert.ok(card.classList.contains('is-products'));assert.equal(chartCount,0,'inline bars replace the independent Chart.js SKU chart');assert.equal(chartWrap.hidden,true);assert.equal(enhanced,1);
assert.equal((tbody.innerHTML.match(/<tr /g)||[]).length,7,'all products remain, not just the reference top six');
assert.ok(tbody.innerHTML.indexOf('LEADER')<tbody.innerHTML.indexOf('Half'),'initial sorting is actual revenue');assert.equal(sort.value,'revenue');
assert.match(tbody.innerHTML,/sku-rank/);assert.match(tbody.innerHTML,/sku-thumb/);assert.match(tbody.innerHTML,/sku-subline/);assert.match(tbody.innerHTML,/--sku-share:0.5/);assert.match(tbody.innerHTML,/менее 0,1%/);
assert.match(tbody.innerHTML,/Отрицательная выручка/);assert.match(tbody.innerHTML,/Нет данных по выручке/);assert.doesNotMatch(tbody.innerHTML,/qty-track/);
assert.doesNotMatch(tbody.innerHTML,/<script>/);assert.match(tbody.innerHTML,/&lt;script&gt;/);assert.match(tbody.innerHTML,/sku-detail/);assert.match(tbody.innerHTML,/sku-delta/);assert.match(tfoot.innerHTML,/data-label="Выручка, ₽">—</);assert.match(tfoot.innerHTML,/>140</);
assert.equal(JSON.stringify(rows),original,'presentation never mutates financial data');assert.doesNotMatch(tbody.innerHTML,/sku-new/,'comparison retains case-insensitive identity');
search.value='half';search.oninput();assert.match(tbody.innerHTML,/Half/);assert.doesNotMatch(tbody.innerHTML,/LEADER/);assert.match(tfoot.innerHTML,/>500</);
search.value='does not exist';search.oninput();assert.match(tbody.innerHTML,/colspan="7"/);assert.equal(tfoot.innerHTML,'');
search.value='';search.oninput();filterButtons[2].onclick();assert.match(tbody.innerHTML,/Half/);assert.doesNotMatch(tbody.innerHTML,/LEADER/);
filterButtons[0].onclick();sort.value='qty';sort.onchange();assert.equal(sort.value,'qty');
window.WBDashboard.renderSkuTable(tbody,tfoot,hint,canvas,{skuRows:[]},null);assert.match(tbody.innerHTML,/Нет данных по артикулам/);assert.equal(tfoot.innerHTML,'');
window.WBDashboard.renderSkuTable(tbody,tfoot,hint,canvas,{skuRows:Array.from({length:1105},(_,i)=>row('many-'+i,i))},null);assert.equal((tbody.innerHTML.match(/<tr /g)||[]).length,1105,'large stores keep every product in the same table');assert.match(tbody.innerHTML,/>1105</);assert.equal(chartCount,0);

// Real presentation controller: finite work, persistent controls, no services.
let reduced=false,hidden=false;const animations=[],observers=[];
const events={},preference={get matches(){return reduced;},addEventListener:(name,fn)=>events.preference=fn};
const button=()=>({attrs:{},setAttribute(k,v){this.attrs[k]=v;},focus(){this.focused=true}});
const details=button(),filters=button(),toolbar={hidden:true};
const bars=Array.from({length:30},(_,i)=>({style:{getPropertyValue:()=>i?'.5':'1'},animate(keys,options){const a={keys,options,cancelled:false,cancel(){this.cancelled=true}};animations.push(a);return a;}}));
const uiCard={classList:classes(),parentElement:{querySelector:s=>s==='#skuDetailsToggle'?details:filters},querySelector:()=>toolbar,querySelectorAll:()=>bars};
const uiWindow={matchMedia:()=>preference},uiDocument={get hidden(){return hidden;},addEventListener:(name,fn)=>events[name]=fn};
class Observer{constructor(fn){this.fn=fn;observers.push(this)}observe(){}disconnect(){this.disconnected=true}}
vm.runInNewContext(fs.readFileSync('assets/sku-products.js','utf8'),{window:uiWindow,document:uiDocument,WeakMap,Set,Number,Math,IntersectionObserver:Observer});
const api=uiWindow.WBSkuProducts;api.enhance(uiCard);assert.equal(details.attrs['aria-expanded'],'false');assert.equal(toolbar.hidden,true);assert.equal(animations.length,0,'offscreen has no animation');
observers[0].fn([{isIntersecting:true}]);assert.equal(animations.length,12,'animation work is bounded, not one loop per product');assert.ok(animations.every(a=>a.options.delay<=150));assert.equal(animations[0].options.duration,760);
details.onclick();filters.onclick();assert.ok(uiCard.classList.contains('is-sku-details'));assert.equal(toolbar.hidden,false);assert.equal(details.textContent,'Краткий вид');
api.enhance(uiCard);assert.ok(animations.every(a=>a.cancelled),'rerender cancels previous animations');assert.equal(details.attrs['aria-expanded'],'true','UI state survives source/filter rerender');
toolbar.onkeydown({key:'Escape'});assert.equal(toolbar.hidden,true);assert.equal(filters.focused,true);
reduced=true;observers.at(-1).fn([{isIntersecting:true}]);assert.equal(animations.length,12);reduced=false;api.enhance(uiCard);observers.at(-1).fn([{isIntersecting:true}]);assert.equal(animations.length,24);
hidden=true;events.visibilitychange();assert.ok(animations.every(a=>a.cancelled));hidden=false;events.preference();api.dispose(uiCard);assert.equal(details.onclick,null);assert.equal(filters.onclick,null);assert.equal(toolbar.onkeydown,null);
for(const page of ['app.html','index.html']){const html=fs.readFileSync(page,'utf8');assert.match(html,/sku-products.css\?v=20261019-layout1/);assert.ok(html.indexOf('sku-products.js')<html.indexOf('dashboard.js'));assert.match(html,/id="skuDetailsToggle"/);assert.match(html,/id="skuFilterToggle"/);}
console.log('SKU Top products PASS: every article, real revenue ranking/bars, unknown/negative/zero/tiny, escaped identity, costs/profit/comparisons/totals, search/ABC/sort, no duplicate Chart, bounded reveal, controls/keyboard, reduced/hidden/rerender/dispose; no services.');
