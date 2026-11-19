import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {readOzonUnit,readOzonMonths,validateOzonModel,calculateOzonUnit,calculateOzonDaily} from '../supabase/functions/wb-api/ozon.ts';
import {ApiError,cents,rub} from '../supabase/functions/wb-api/core.ts';
import {costCatalogue} from '../supabase/functions/wb-api/articles.ts';

const window={};
vm.runInNewContext(readFileSync(new URL('../assets/ozon-model.js',import.meta.url),'utf8'),{window,Map,BigInt,Number,Date});
const modelBuilder=window.WBOzonModel;
const shopId='00000000-0000-4000-8000-000000000001';
const otherShop='00000000-0000-4000-8000-000000000002';
const lastDay=month=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
const sale=(date,article,amount,quantity=1)=>({date,article,amount,quantity,group:'Продажи',type:'Выручка',name:'Товар '+article});
const refund=(date,article,amount,quantity=1)=>({date,article,amount,quantity,group:'Возвраты',type:'Возврат выручки'});
const fee=(date,article,amount,group='Услуги доставки')=>({date,article,amount,quantity:0,group});
function build(rows,coverage){
 const model=modelBuilder.create(coverage);
 for(const row of rows)modelBuilder.add(model,row);
 return JSON.parse(JSON.stringify(modelBuilder.finish(model)));
}
function imported(month,rows,{coverage={from:month+'-01',to:lastDay(month),declared:true},detailed=true,operating='123.45',external='67.89'}={}){
 // Exercise unmodified output from the actual writer. Only legacy fixtures
 // are explicitly reduced to the stored quantity-only version-1 schema.
 const model=build(rows,coverage);
 if(!detailed)for(const day of Object.values(model.days))day.products=day.products.filter(p=>p.quantity!==0).map(({article,quantity})=>({article,quantity}));
 const advertising=model.products.reduce((n,p)=>n+cents(p.groups['Продвижение и реклама']),0n),ads=advertising<0n?-advertising:0n;
 return {snapshot:{shop_id:shopId,month:month+'-01',model,updated_at:month+'-15T12:00:00Z'},report:{shop_id:shopId,marketplace:'ozon',year:Number(month.slice(0,4)),month:Number(month.slice(5)),
  sales_amount:model.totals.sales,transfer_total:rub(cents(model.totals.net)+ads),ads_spend:rub(ads),bought_qty:model.totals.quantity,operational_expenses:operating,external_promotion_expenses:external}};
}
function client(imports,{prices=[{article:'A',cost_price:'100.00'},{article:'B',cost_price:'40.00'}],rate='6.00',errors={},noShop=false}={}){
 const calls=[];
 const tables={
  ozon_analytics_months:[...imports.map(i=>i.snapshot),{shop_id:otherShop,month:'2026-10-01',model:null}],
  monthly_reports:[...imports.map(i=>i.report),{shop_id:shopId,marketplace:'wildberries',year:2026,month:10},{shop_id:otherShop,marketplace:'ozon',year:2026,month:10}],
  shops:noShop?[]:[{id:shopId,tax_rate:rate},{id:otherShop,tax_rate:99}],
  sku_costs:[...prices.map(p=>({shop_id:shopId,...p})),{shop_id:otherShop,article:'A',cost_price:'999999.00'}],
 };
 const admin={from(table){
  assert.ok(Object.hasOwn(tables,table),'only existing manual Ozon reports, shared shop and catalogue may be read');
  const filters=[],orders=[];let columns,offset=0,end=Infinity;
  function run(single=false){
   calls.push({table,columns,filters:structuredClone(filters),offset,end});
   if(errors[table])return {data:null,error:errors[table]};
   let rows=tables[table].filter(row=>filters.every(([op,key,value])=>op==='eq'?row[key]===value:op==='gte'?row[key]>=value:row[key]<=value));
   for(const [key,ascending] of orders.slice().reverse())rows=rows.slice().sort((a,b)=>(typeof a[key]==='number'&&typeof b[key]==='number'?a[key]-b[key]:String(a[key]).localeCompare(String(b[key])))*(ascending?1:-1));
   rows=rows.slice(offset,end===Infinity?undefined:end+1);
   if(table==='ozon_analytics_months'&&columns==='month,coverage:model->coverage')rows=rows.map(r=>({month:r.month,coverage:r.model?.coverage}));
   return {data:single?(rows[0]??null):rows,error:null};
  }
  const q={select(value){columns=value;return q;},eq(key,value){filters.push(['eq',key,value]);return q;},gte(key,value){filters.push(['gte',key,value]);return q;},lte(key,value){filters.push(['lte',key,value]);return q;},
   order(key,options={}){orders.push([key,options.ascending!==false]);return q;},range(from,to){offset=from;end=to;return q;},single:async()=>run(true),then(resolve,reject){return Promise.resolve(run()).then(resolve,reject);}};
  return q;
 }};
 return {admin,calls,tables};
}
const read=(f,from,to,range)=>readOzonUnit(f.admin,shopId,from,to,range);
const product=(r,article)=>r.products.find(p=>p.article.trim().toLowerCase()===article.toLowerCase());
const expense=(r,key)=>r.common_expenses.find(e=>e.key===key);
function balanced(r){
 for(const p of r.products){
  assert.equal(p.tax,p.expenses.find(e=>e.key==='tax').amount);
  if(p.total_expenses!=null){assert.equal(cents(p.total_expenses),p.expenses.reduce((n,e)=>n+cents(e.amount),0n));assert.equal(cents(p.net_profit),cents(p.sales)-cents(p.total_expenses));}
  assert.ok(p.expenses.every(e=>!['operating','external'].includes(e.key)));
 }
 for(const [field,key] of [['sales','sales'],['net_profit','net_profit'],['internal_ads','internal_ads'],['expenses','total_expenses']]){
  assert.equal(r.totals[field],r.products.some(p=>p[key]==null)?null:rub(r.products.reduce((n,p)=>n+cents(p[key]),0n)));
 }
}
function scoped(f,pages=1){
 assert.equal(f.calls.filter(c=>c.table==='shops').length,1,'one shop read for the whole selection');
 assert.equal(f.calls.filter(c=>c.table==='sku_costs').length,pages,'one shared catalogue traversal for the whole selection');
 assert.equal(f.calls.filter(c=>c.table==='ozon_analytics_months').length,1);
 assert.equal(f.calls.filter(c=>c.table==='monthly_reports').length,1);
 for(const c of f.calls)assert.ok(c.filters.some(([op,key,value])=>op==='eq'&&key===(c.table==='shops'?'id':'shop_id')&&value===shopId));
 assert.ok(f.calls.filter(c=>c.table==='monthly_reports').every(c=>c.filters.some(([op,k,v])=>op==='eq'&&k==='marketplace'&&v==='ozon')));
}
const octoberRows=[
 sale('2026-10-01','A','10000.00',20),
 sale('2026-10-10','A','1000.00',2),fee('2026-10-10','A','-100.00','Вознаграждение Ozon'),fee('2026-10-10','A','-50.00'),fee('2026-10-10','A','-30.00','Продвижение и реклама'),
 sale('2026-10-10','B','200.00'),fee('2026-10-10','B','-10.00'),fee('2026-10-10','','-70.00','Продвижение и реклама'),fee('2026-10-10','','-20.00','Услуги FBO'),
 refund('2026-10-11',' a ','-500.00'),fee('2026-10-11','a','5.00'),fee('2026-10-11','a','20.00','Компенсации и декомпенсации'),
 sale('2026-10-29','B','2000.00',10),
];

test('inclusive arbitrary dates use actual dated direct SKU amounts, signed fees and weighted ratios',async()=>{
 const source=imported('2026-10',octoberRows),before=structuredClone(source),f=client([source]),period={dateFrom:'2026-10-10',dateTo:'2026-10-11'};
 const r=await read(f,'2026-10','2026-10',period);
 assert.equal(r.status,'ready');assert.deepEqual(r.period,period);assert.equal(r.date_basis,'accrual_date');assert.equal(r.method,'direct_only');
 assert.equal(product(r,'A').quantity,1);assert.equal(product(r,'A').sales,'500.00');assert.equal(product(r,'A').net_profit,'215.00');assert.equal(product(r,'B').net_profit,'138.00');
 assert.equal(r.totals.sales,'700.00');assert.equal(r.totals.net_profit,'353.00');assert.equal(r.totals.internal_ads,'30.00');
 assert.equal(r.totals.drr,30/700*100);assert.equal(r.totals.margin,353/700*100);assert.equal(r.totals.profitability,353/347*100);
 assert.equal(expense(r,'internal').amount,'70.00');assert.equal(expense(r,'ozon:Услуги FBO').amount,'20.00');
 assert.equal(expense(r,'operating').amount,null);assert.equal(expense(r,'external').amount,null);assert.equal(expense(r,'operating').status,'unavailable');assert.equal(expense(r,'operating').excluded,true);
 assert.match(expense(r,'operating').note,/без дат/);assert.match(r.message,/исключены/);
 assert.deepEqual(r.excluded_expenses,['operational_expenses','external_promotion_expenses']);assert.equal(r.coverage[0].dateFrom,'2026-10-01');assert.equal(r.coverage[0].dateTo,'2026-10-31');
 assert.doesNotMatch(JSON.stringify(r),/orders_count|orders_amount|placed_orders|order_id|posting_number/);
 assert.deepEqual(source,before,'reading never changes imported aggregates');balanced(r);scoped(f);
});

test('a single selected day includes refunds and expense-only SKUs without inferring orders',async()=>{
 const f=client([imported('2026-10',octoberRows)]),period={dateFrom:'2026-10-11',dateTo:'2026-10-11'},r=await read(f,'2026-10','2026-10',period),a=product(r,'A');
 assert.equal(r.status,'ready');assert.deepEqual(r.period,period);assert.equal(r.products.length,1);assert.equal(a.quantity,-1);assert.equal(a.sales,'-500.00');assert.equal(a.tax,'-30.00');
 assert.equal(a.expenses.find(e=>e.key==='cogs').amount,'-100.00');assert.equal(a.net_profit,'-345.00');assert.equal(a.margin,null);assert.equal(a.drr,null);assert.equal(r.totals.margin,null);balanced(r);
});

test('cross-year selections merge articles, tax and expense categories exactly once',async()=>{
 const december=imported('2025-12',[sale('2025-12-30','B','9000.00'),sale('2025-12-31','A','100.00'),fee('2025-12-31','A','-10.00'),fee('2025-12-31','A','-5.00','Продвижение и реклама')]);
 const january=imported('2026-01',[sale('2026-01-01',' a ','200.00',2),refund('2026-01-01','a','-50.00'),fee('2026-01-01','a','-20.00'),fee('2026-01-01','a','5.00'),fee('2026-01-01','a','-10.00','Продвижение и реклама'),sale('2026-01-02','B','5000.00')]);
 const f=client([december,january],{prices:[{article:'A',cost_price:'20.00'}]}),period={dateFrom:'2025-12-31',dateTo:'2026-01-01'},r=await read(f,'2025-12','2026-01',period),a=product(r,'A');
 assert.equal(r.status,'ready');assert.equal(r.products.length,1);assert.deepEqual(r.period,period);assert.equal(a.sales,'250.00');assert.equal(a.quantity,2);assert.equal(a.tax,'15.00');assert.equal(a.net_profit,'155.00');assert.equal(a.internal_ads,'15.00');assert.equal(a.drr,6);assert.equal(a.margin,62);
 assert.equal(a.expenses.find(e=>e.key==='ozon:Услуги доставки').amount,'25.00');assert.equal(a.expenses.find(e=>e.key==='cogs').amount,'40.00');assert.equal(r.coverage.length,2);balanced(r);scoped(f);
});

test('explicit full calendar months preserve legacy monthly products, common costs and totals',async()=>{
 const months=['2026-08','2026-09'],imports=months.map(m=>imported(m,[sale(m+'-10','A','100.00'),fee(m+'-11','A','-3.00','Продвижение и реклама')],{detailed:false}));
 const f=client(imports,{prices:[{article:'A',cost_price:'10.00'}]}),legacy=await read(f,months[0],months[1]);
 const r=await read(client(imports,{prices:[{article:'A',cost_price:'10.00'}]}),months[0],months[1],{dateFrom:'2026-08-01',dateTo:'2026-09-30'});
 assert.equal(r.status,'ready');assert.deepEqual(r.products,legacy.products);assert.deepEqual(r.totals,legacy.totals);assert.deepEqual(r.common_expenses,legacy.common_expenses);assert.deepEqual(r.excluded_expenses,[]);
 assert.equal(expense(r,'operating').amount,'246.90');assert.equal(expense(r,'external').amount,'135.78');balanced(r);
});

test('quantity-only legacy daily products cannot masquerade as exact SKU finances',async()=>{
 const source=imported('2026-10',octoberRows,{detailed:false}),f=client([source]),period={dateFrom:'2026-10-10',dateTo:'2026-10-11'},r=await read(f,'2026-10','2026-10',period);
 assert.equal(r.status,'needs_import');assert.deepEqual(r.products,[]);assert.deepEqual(r.period,period);assert.deepEqual(r.pending,[{month:'2026-10',status:'needs_import'}]);assert.match(r.message,/Отчёт по начислениям/);
 assert.equal((await read(client([source]),'2026-10','2026-10')).status,'ready');
 assert.equal((await read(client([source]),'2026-10','2026-10',{dateFrom:'2026-10-01',dateTo:'2026-10-31'})).status,'ready');
});

test('a legacy partial import supports its whole actual coverage and excludes undated monthly expenses',async()=>{
 const coverage={from:'2026-10-10',to:'2026-10-11',declared:false},source=imported('2026-10',octoberRows.filter(r=>r.date>=coverage.from&&r.date<=coverage.to),{coverage,detailed:false});
 const period={dateFrom:coverage.from,dateTo:coverage.to},r=await read(client([source]),'2026-10','2026-10',period);
 assert.equal(r.status,'ready');assert.deepEqual(r.period,period);assert.equal(r.totals.sales,'700.00');assert.equal(expense(r,'operating').amount,null);assert.equal(r.coverage[0].declared,false);
 for(const requested of [{dateFrom:'2026-10-09',dateTo:'2026-10-11'},{dateFrom:'2026-10-10',dateTo:'2026-10-12'},{dateFrom:'2026-10-01',dateTo:'2026-10-31'}]){
  const missing=await read(client([source]),'2026-10','2026-10',requested);assert.equal(missing.status,'needs_import');assert.deepEqual(missing.period,requested);assert.deepEqual(missing.products,[]);
 }
});

test('partial report coverage supports a fully covered subset but never clips requested endpoints',async()=>{
 const coverage={from:'2026-10-10',to:'2026-10-20',declared:true},source=imported('2026-10',[sale('2026-10-10','A','999.00'),sale('2026-10-15','A','100.00'),sale('2026-10-20','B','999.00')],{coverage});
 const period={dateFrom:'2026-10-14',dateTo:'2026-10-19'},r=await read(client([source]),'2026-10','2026-10',period);
 assert.equal(r.status,'ready');assert.equal(r.totals.sales,'100.00');assert.deepEqual(r.period,period);
 const requested={...period,dateTo:'2026-10-21'},incomplete=await read(client([source]),'2026-10','2026-10',requested);assert.equal(incomplete.status,'needs_import');assert.deepEqual(incomplete.period,requested);
});

test('missing interior imports and incomplete interior coverage reject the whole selection',async()=>{
 const august=imported('2026-08',[sale('2026-08-31','A','100.00')]),october=imported('2026-10',[sale('2026-10-01','A','100.00')]),period={dateFrom:'2026-08-31',dateTo:'2026-10-01'};
 for(const imports of [[august,october],[august,imported('2026-09',[sale('2026-09-10','A','100.00')],{coverage:{from:'2026-09-02',to:'2026-09-29',declared:true}}),october]]){
  const r=await read(client(imports),'2026-08','2026-10',period);assert.equal(r.status,'needs_import');assert.deepEqual(r.products,[]);assert.deepEqual(r.period,period);assert.deepEqual(r.pending,[{month:'2026-09',status:'needs_import'}]);
 }
});

test('only the requested months are read when date endpoints are inside wider supported month bounds',async()=>{
 const f=client([imported('2026-10',octoberRows)]),period={dateFrom:'2026-10-10',dateTo:'2026-10-11'},r=await read(f,'2026-08','2026-10',period);
 assert.equal(r.status,'ready');assert.deepEqual(r.period,period);const query=f.calls.find(c=>c.table==='ozon_analytics_months');
 assert.ok(query.filters.some(([op,k,v])=>op==='gte'&&k==='month'&&v==='2026-10-01'));assert.ok(query.filters.some(([op,k,v])=>op==='lte'&&k==='month'&&v==='2026-10-01'));scoped(f);
});

test('empty days inside imported coverage are known zero accruals, including legacy imports',async()=>{
 const period={dateFrom:'2026-10-05',dateTo:'2026-10-06'},r=await read(client([imported('2026-10',octoberRows,{detailed:false})]),'2026-10','2026-10',period);
 assert.equal(r.status,'ready');assert.deepEqual(r.period,period);assert.deepEqual(r.products,[]);assert.equal(r.totals.sales,'0.00');assert.equal(r.totals.net_profit,'0.00');assert.equal(r.totals.margin,null);assert.equal(r.totals.drr,null);assert.equal(expense(r,'operating').amount,null);
});

test('strict calendar dates, month bounds, supported history and 36-month limit fail before reads',async()=>{
 const invalid=[null,{},'2026-10-10',{dateFrom:null,dateTo:'2026-10-11'},{dateFrom:'2026-10-10'},{dateFrom:'2026-10-11',dateTo:'2026-10-10'},
  {dateFrom:'2026-10-1',dateTo:'2026-10-11'},{dateFrom:'2026-10-10T00:00:00Z',dateTo:'2026-10-11'},{dateFrom:'2026-10-00',dateTo:'2026-10-11'},
  {dateFrom:'2026-10-10',dateTo:'2026-10-32'},{dateFrom:'2026-09-30',dateTo:'2026-10-11'},{dateFrom:'2026-10-10',dateTo:'2026-11-01'}];
 for(const range of invalid){const f=client([]);await assert.rejects(()=>read(f,'2026-10','2026-10',range),e=>e instanceof ApiError&&e.status===400);assert.equal(f.calls.length,0);}
 for(const [from,to,range] of [['2026-02','2026-02',{dateFrom:'2026-02-29',dateTo:'2026-02-29'}],['2026-13','2026-13'],['1999-12','1999-12'],['2026-10','2026-09'],['2023-10','2026-10'],['9999-01','9999-01']]){
  const f=client([]);await assert.rejects(()=>read(f,from,to,range),e=>e instanceof ApiError&&e.status===400);assert.equal(f.calls.length,0);
 }
});

test('a real leap day is a valid exact date selection',async()=>{
 const period={dateFrom:'2024-02-29',dateTo:'2024-02-29'},r=await read(client([imported('2024-02',[sale('2024-02-29','A','100.00')])]),'2024-02','2024-02',period);
 assert.equal(r.status,'ready');assert.deepEqual(r.period,period);assert.equal(r.totals.sales,'100.00');
});

test('future-day validation uses the same Moscow day boundary as supported Ozon months',async t=>{
 t.mock.method(Date,'now',()=>Date.parse('2026-11-01T21:30:00Z'));
 const source=imported('2026-11',[sale('2026-11-02','A','100.00')],{coverage:{from:'2026-11-01',to:'2026-11-02',declared:true}}),period={dateFrom:'2026-11-02',dateTo:'2026-11-02'};
 assert.equal((await read(client([source]),'2026-11','2026-11',period)).status,'ready');
 const f=client([source]);await assert.rejects(()=>read(f,'2026-11','2026-11',{...period,dateTo:'2026-11-03'}),e=>e.status===400);assert.equal(f.calls.length,0);
});

test('null, absent and malformed imports are needs_import rather than runtime errors or zero money',async()=>{
 const original=imported('2026-10',octoberRows),mutations=[
  s=>{s.snapshot.model=null;},s=>{s.snapshot.model={};},s=>{s.snapshot.model.totals=null;},s=>{s.snapshot.model.products=null;},s=>{s.snapshot.model.days=null;},
  s=>{s.snapshot.model.coverage={from:'2026-10-32',to:'2026-10-31'};},s=>{s.snapshot.model.days['2026-10-10'].groups=null;},s=>{s.snapshot.model.days['2026-10-10'].sales=null;},
  s=>{s.snapshot.model.products[0].groups['Услуги доставки']=null;},s=>{s.snapshot.model.products[0].sales='NaN';},s=>{s.snapshot.model.products[0].quantity=1.5;},s=>{s.snapshot.model.days['2026-10-10'].products=null;},
  s=>{s.report=null;},s=>{s.report.sales_amount=null;},s=>{delete s.report.ads_spend;},s=>{s.snapshot.model.days['2026-10-99']=s.snapshot.model.days['2026-10-10'];},
 ];
 for(const mutate of mutations){
  const source=structuredClone(original);mutate(source);const f=client([original]);f.tables.ozon_analytics_months[0]=source.snapshot;f.tables.monthly_reports[0]=source.report??{};
  const period={dateFrom:'2026-10-10',dateTo:'2026-10-11'},r=await read(f,'2026-10','2026-10',period);assert.equal(r.status,'needs_import');assert.deepEqual(r.products,[]);assert.deepEqual(r.period,period);
  assert.equal(validateOzonModel(source.snapshot.model,source.report),false);
 }
 const f=client([]);assert.equal((await read(f,'2026-10','2026-10',{dateFrom:'2026-10-10',dateTo:'2026-10-11'})).status,'needs_import');
});

test('replaced report totals invalidate exact reads even if requested days were unchanged',async()=>{
 for(const field of ['sales_amount','transfer_total','ads_spend','bought_qty']){
  const source=imported('2026-10',octoberRows);source.report[field]=field==='bought_qty'?source.report[field]+1:rub(cents(source.report[field])+1n);
  const r=await read(client([source]),'2026-10','2026-10',{dateFrom:'2026-10-10',dateTo:'2026-10-11'});assert.equal(r.status,'needs_import');assert.deepEqual(r.products,[]);
 }
});

test('daily SKU totals and every expense group must reconcile with daily and monthly ledgers',async()=>{
 const mutations=[
  m=>{m.days['2026-10-10'].products[0].sales='1001.00';m.days['2026-10-10'].products[0].net='821.00';},
  m=>{const groups=m.days['2026-10-10'].products[0].groups;groups['Услуги FBO']=groups['Услуги доставки'];delete groups['Услуги доставки'];},
  m=>{const [a,b]=m.days['2026-10-10'].products;a.sales=rub(cents(a.sales)+1n);a.net=rub(cents(a.net)+1n);b.sales=rub(cents(b.sales)-1n);b.net=rub(cents(b.net)-1n);},
  m=>{m.days['2026-10-29'].products[0].net=null;},
  m=>{m.days['2026-10-10'].products[0].sales='NaN';},
  m=>{m.days['2026-10-10'].products[0].groups['Услуги доставки']='not money';},
  m=>{m.days['2026-10-10'].products[0].article='Other';},
 ];
 for(const mutate of mutations){const source=imported('2026-10',octoberRows);mutate(source.snapshot.model);const r=await read(client([source]),'2026-10','2026-10',{dateFrom:'2026-10-10',dateTo:'2026-10-11'});assert.equal(r.status,'needs_import');assert.deepEqual(r.products,[]);}
});

test('zero-row buckets with money or quantities are not treated as empty imported days',async()=>{
 const source=imported('2026-10',octoberRows),day=source.snapshot.model.days['2026-10-10'];day.rows=0;
 const period={dateFrom:'2026-10-10',dateTo:'2026-10-10'},r=await read(client([source]),'2026-10','2026-10',period);
 assert.equal(r.status,'needs_import');assert.deepEqual(r.period,period);assert.deepEqual(r.products,[]);
});

test('missing cost prices preserve known sales, tax and ads while propagating unknown profit',async()=>{
 const f=client([imported('2026-10',octoberRows)],{prices:[{article:'B',cost_price:'40.00'}]}),r=await read(f,'2026-10','2026-10',{dateFrom:'2026-10-10',dateTo:'2026-10-11'});
 assert.equal(r.status,'ready');assert.equal(product(r,'A').missing_costs,true);assert.equal(product(r,'A').net_profit,null);assert.equal(product(r,'A').total_expenses,null);assert.equal(product(r,'A').tax,'30.00');
 assert.equal(product(r,'B').net_profit,'138.00');assert.equal(r.totals.sales,'700.00');assert.equal(r.totals.net_profit,null);assert.equal(r.totals.expenses,null);assert.equal(r.totals.margin,null);assert.equal(r.totals.profitability,null);assert.equal(r.totals.drr,30/700*100);balanced(r);
 const empty=client([imported('2026-10',octoberRows)],{prices:[]});assert.equal((await read(empty,'2026-10','2026-10',{dateFrom:'2026-10-10',dateTo:'2026-10-11'})).totals.net_profit,null);
});

test('zero net quantities and expense-only products need no invented cost price',async()=>{
 const rows=[sale('2026-10-10','A','100.00'),refund('2026-10-11','a','-100.00'),fee('2026-10-10','C','-1.01','Продвижение и реклама'),fee('2026-10-11','D','-2.02')];
 const r=await read(client([imported('2026-10',rows)],{prices:[]}),'2026-10','2026-10',{dateFrom:'2026-10-10',dateTo:'2026-10-11'});
 assert.equal(r.status,'ready');assert.equal(product(r,'A').quantity,0);assert.equal(product(r,'A').net_profit,'0.00');assert.equal(product(r,'A').missing_costs,false);assert.equal(product(r,'C').internal_ads,'1.01');assert.equal(product(r,'C').drr,null);assert.equal(product(r,'D').net_profit,'-2.02');assert.equal(r.totals.net_profit,'-3.03');balanced(r);
});

test('case-insensitive prices use the shared current catalogue and never another shop',async()=>{
 const source=imported('2026-10',octoberRows),f=client([source],{prices:[{article:' A ',cost_price:0,updated_at:'2026-11-19'},{article:'a',cost_price:'10.01',updated_at:'2026-11-01'},{article:'A',cost_price:'9.99',updated_at:'2026-10-01'},{article:'B',cost_price:'40.00'}]});
 const r=await read(f,'2026-10','2026-10',{dateFrom:'2026-10-10',dateTo:'2026-10-11'});assert.equal(product(r,'A').cost_price,'10.01');assert.equal(product(r,'A').expenses.find(e=>e.key==='cogs').amount,'10.01');scoped(f);balanced(r);
});

test('shared and undated monthly expenses cannot change direct SKU profitability',async()=>{
 const rows=octoberRows.filter(r=>r.article),base=imported('2026-10',rows),changed=imported('2026-10',[...rows,fee('2026-10-10','','-999999.99','Продвижение и реклама'),fee('2026-10-11','','1234.56','Компенсации и декомпенсации')],{operating:'999999.99',external:'888888.88'}),period={dateFrom:'2026-10-10',dateTo:'2026-10-11'};
 const a=await read(client([base]),'2026-10','2026-10',period),b=await read(client([changed]),'2026-10','2026-10',period);
 assert.deepEqual(a.products,b.products);assert.deepEqual(a.totals,b.totals);assert.equal(expense(b,'internal').amount,'999999.99');assert.equal(expense(b,'operating').amount,null);assert.equal(expense(b,'external').amount,null);
});

test('unidentified sales, refund credits and tax remain common rather than allocated to SKUs',async()=>{
 const source=imported('2026-10',[sale('2026-10-10','A','100.00'),sale('2026-10-10','','50.00',0),fee('2026-10-10','','-10.00'),fee('2026-10-11','','2.00')]);
 const r=await read(client([source],{prices:[{article:'A',cost_price:'10.00'}]}),'2026-10','2026-10',{dateFrom:'2026-10-10',dateTo:'2026-10-11'});
 assert.equal(r.products.length,1);assert.equal(product(r,'A').net_profit,'84.00');assert.equal(r.totals.sales,'100.00');assert.equal(expense(r,'tax').amount,'3.00');assert.equal(expense(r,'ozon:Услуги доставки').amount,'8.00');assert.equal(expense(r,'unidentified_sales').amount,'50.00');assert.equal(expense(r,'unidentified_sales').reference,true);balanced(r);
});

test('partial plus complete months never turn excluded manual expenses back into known sums',async()=>{
 const imports=['2026-09','2026-10'].map(m=>imported(m,[sale(m+'-10','A','100.00'),sale(m+'-20','A','100.00')]));
 for(const period of [{dateFrom:'2026-09-15',dateTo:'2026-10-31'},{dateFrom:'2026-09-01',dateTo:'2026-10-15'}]){
  const r=await read(client(imports),'2026-09','2026-10',period);assert.equal(r.status,'ready');assert.equal(expense(r,'operating').amount,null);assert.equal(expense(r,'operating').status,'unavailable');assert.equal(expense(r,'external').amount,null);assert.equal(expense(r,'external').excluded,true);assert.deepEqual(r.excluded_expenses,['operational_expenses','external_promotion_expenses']);balanced(r);
 }
});

test('tax reconciles to the selected sales with exact signed half-cent rounding',async()=>{
 const source=imported('2026-10',[sale('2026-10-10','A','0.10',0),sale('2026-10-10','B','0.10',0),sale('2026-10-29','A','100.00',0)]),r=await read(client([source],{rate:'6.00',prices:[]}),'2026-10','2026-10',{dateFrom:'2026-10-10',dateTo:'2026-10-10'});
 assert.equal(r.status,'ready');assert.equal(r.products.reduce((n,p)=>n+cents(p.tax),0n),1n);assert.equal(r.totals.net_profit,'0.19');balanced(r);
 const returned=imported('2026-10',[refund('2026-10-10','A','-0.01',0),sale('2026-10-29','A','100.00',0)]),negative=await read(client([returned],{rate:'50.00',prices:[]}),'2026-10','2026-10',{dateFrom:'2026-10-10',dateTo:'2026-10-10'});
 assert.equal(product(negative,'A').tax,'0.00');assert.equal(product(negative,'A').net_profit,'-0.01');balanced(negative);
});

test('merged tax fields preserve the same monthly rounding as legacy multi-month calls',async()=>{
 const imports=['2026-08','2026-09'].map(m=>imported(m,[sale(m+'-10','A','0.10',0)])),period={dateFrom:'2026-08-01',dateTo:'2026-09-30'},r=await read(client(imports,{prices:[]}),'2026-08','2026-09',period);
 assert.equal(product(r,'A').tax,'0.02');assert.equal(product(r,'A').expenses.find(e=>e.key==='tax').amount,'0.02');balanced(r);
});

test('money stays exact beyond Number safe integer cents, including report subtraction and tax',async()=>{
 const rows=Array.from({length:100},(_,i)=>sale('2026-10-10','A',i===99?'900719925475.02':'900719925474.09'));
 rows.push(fee('2026-10-10','A','-0.01'),fee('2026-10-10','A','-0.01','Продвижение и реклама'),sale('2026-10-29','B','1.00'));
 const source=imported('2026-10',rows);assert.equal(source.snapshot.model.days['2026-10-10'].sales,'90071992547409.93');assert.equal(validateOzonModel(source.snapshot.model,source.report),true);
 const r=await read(client([source],{prices:[{article:'A',cost_price:'0.01'},{article:'B',cost_price:'0.01'}]}),'2026-10','2026-10',{dateFrom:'2026-10-10',dateTo:'2026-10-10'}),a=product(r,'A');
 assert.equal(r.status,'ready');assert.equal(a.sales,'90071992547409.93');assert.equal(a.tax,'5404319552844.60');assert.equal(a.internal_ads,'0.01');assert.equal(a.net_profit,'84667672994564.31');balanced(r);
});

test('a catalogue spanning multiple pages is fetched once for a range and reused for every month',async()=>{
 const prices=[...Array.from({length:1000},(_,i)=>({article:'000'+String(i).padStart(4,'0'),cost_price:'999.00'})),{article:'A',cost_price:'1.23'}],imports=['2026-08','2026-09','2026-10'].map(m=>imported(m,[sale(m+'-10','A','10.00')])),f=client(imports,{prices});
 const r=await read(f,'2026-08','2026-10',{dateFrom:'2026-08-10',dateTo:'2026-10-10'});assert.equal(r.status,'ready');assert.equal(product(r,'A').expenses.find(e=>e.key==='cogs').amount,'3.69');scoped(f,2);balanced(r);
});

test('source read errors and a missing shop fail clearly without fallback cross-shop data',async()=>{
 for(const table of ['ozon_analytics_months','monthly_reports','shops','sku_costs']){
  const f=client([imported('2026-10',octoberRows)],{errors:{[table]:{message:'synthetic read error'}}});await assert.rejects(()=>read(f,'2026-10','2026-10',{dateFrom:'2026-10-10',dateTo:'2026-10-11'}),e=>e instanceof ApiError&&e.status===500);
 }
 await assert.rejects(()=>read(client([imported('2026-10',octoberRows)],{noShop:true}),'2026-10','2026-10'),e=>e instanceof ApiError&&e.status===500);
});

test('legacy pure calculation remains compatible with the real quantity-only daily schema',()=>{
 const source=imported('2026-10',octoberRows,{detailed:false});assert.equal(validateOzonModel(source.snapshot.model,source.report),true);
 const r=calculateOzonUnit(source.snapshot.model,source.report,new Map([['a',{cost_price:'100.00'}],['b',{cost_price:'40.00'}]]),'6.00');assert.equal(r.status,'ready');assert.equal(r.products.length,2);
 assert.equal(calculateOzonUnit(null,source.report,new Map(),6).status,'needs_import');
});

test('month discovery preserves legacy months and adds actual partial coverage in one compact read',async()=>{
 const september=imported('2026-09',[sale('2026-09-10','A','100.00')],{coverage:{from:'2026-09-07',to:'2026-09-22',declared:true},detailed:false});
 const october=imported('2026-10',[sale('2026-10-10','A','100.00')],{coverage:{from:'2026-10-05',to:'2026-10-15',declared:false},detailed:false});
 const f=client([september,october]),r=await readOzonMonths(f.admin,shopId);
 assert.deepEqual(r.months,['2026-10','2026-09']);assert.deepEqual(r.periods,[{month:'2026-10',dateFrom:'2026-10-05',dateTo:'2026-10-15'},{month:'2026-09',dateFrom:'2026-09-07',dateTo:'2026-09-22'}]);
 assert.equal(f.calls.length,2);assert.equal(f.calls[0].table,'monthly_reports');assert.equal(f.calls[1].table,'ozon_analytics_months');assert.equal(f.calls[1].columns,'month,coverage:model->coverage');
 for(const c of f.calls)assert.ok(c.filters.some(([op,k,v])=>op==='eq'&&k==='shop_id'&&v===shopId));
 assert.ok(f.calls[0].filters.some(([op,k,v])=>op==='eq'&&k==='marketplace'&&v==='ozon'));
 const defaults={dateFrom:r.periods[0].dateFrom,dateTo:r.periods[0].dateTo};assert.equal((await read(client([october]),'2026-10','2026-10',defaults)).status,'ready','calendar defaults for a partial legacy file select its actual complete coverage');
});

test('month discovery omits missing, invalid, foreign and orphaned coverage without changing the month list',async()=>{
 const original=imported('2026-10',octoberRows),mutations=[s=>{s.snapshot.model=null;},s=>{s.snapshot.model.coverage=null;},s=>{s.snapshot.model.coverage={from:'2026-10-32',to:'2026-10-31'};},
  s=>{s.snapshot.model.coverage={from:'2026-10-10',to:'2026-10-09'};},s=>{s.snapshot.model.coverage={from:'2026-09-01',to:'2026-10-31'};}];
 for(const mutate of mutations){const source=structuredClone(original);mutate(source);const f=client([source]);f.tables.ozon_analytics_months.push(imported('2026-09',[sale('2026-09-10','A','100.00')]).snapshot);
  const r=await readOzonMonths(f.admin,shopId);assert.deepEqual(r.months,['2026-10']);assert.deepEqual(r.periods,[]);
 }
 const empty=await readOzonMonths(client([]).admin,shopId);assert.deepEqual(empty,{months:[],periods:[]});
});

test('month discovery reports errors from either read without loading money, products or settings',async()=>{
 for(const table of ['monthly_reports','ozon_analytics_months']){
  const f=client([],{errors:{[table]:{message:'synthetic read error'}}});await assert.rejects(()=>readOzonMonths(f.admin,shopId),e=>e instanceof ApiError&&e.status===500);assert.equal(f.calls.length,2);
 }
});

test('writer stores complete independent per-day SKU ledgers from each actual accrual row',()=>{
 const rows=[sale('2026-10-10',' A ','1000.00',2),fee('2026-10-10','a','-100.00','Вознаграждение Ozon'),refund('2026-10-11','a','-500.00'),fee('2026-10-11','A','5.00'),fee('2026-10-11','A','20.00','Компенсации и декомпенсации')];
 const model=build(rows,{from:'2026-10-01',to:'2026-10-31',declared:true}),first=model.days['2026-10-10'].products[0],second=model.days['2026-10-11'].products[0],monthly=model.products[0];
 assert.equal(model.version,1);assert.equal(model.products.length,1);assert.deepEqual(Object.keys(first).sort(),Object.keys(monthly).sort());
 assert.equal(first.article,'A');assert.equal(first.rows,2);assert.equal(first.sales,'1000.00');assert.equal(first.net,'900.00');assert.equal(first.quantity,2);assert.deepEqual(first.groups,{'Вознаграждение Ozon':'-100.00'});
 assert.equal(second.rows,3);assert.equal(second.sales,'-500.00');assert.equal(second.net,'-475.00');assert.equal(second.quantity,-1);assert.deepEqual(second.groups,{'Услуги доставки':'5.00','Компенсации и декомпенсации':'20.00'});
 assert.equal(monthly.rows,5);assert.equal(monthly.sales,'500.00');assert.equal(monthly.net,'425.00');assert.equal(monthly.quantity,1);assert.equal(Object.keys(model.days).length,2,'coverage does not create synthetic daily buckets');
});

test('writer retains expense-only and unassigned day buckets, zero-quantity sales and every fee group',()=>{
 const rows=[sale('2026-10-10','A','12.34',0),fee('2026-10-10','C','-1.01','Продвижение и реклама'),fee('2026-10-10','c','-2.02'),fee('2026-10-10','','-3.04','Продвижение и реклама'),fee('2026-10-10','','-5.05','Услуги FBO'),fee('2026-10-10','C','0.03','Неизвестная услуга')];
 const model=build(rows,{from:'2026-10-10',to:'2026-10-11',declared:true}),day=model.days['2026-10-10'],c=day.products.find(p=>p.article==='C'),common=day.products.find(p=>p.article==='');
 assert.equal(day.products.length,3);assert.equal(day.rows,6);assert.equal(day.quantity,0);assert.equal(day.products.find(p=>p.article==='A').sales,'12.34');assert.equal(c.quantity,0);assert.equal(c.rows,3);assert.equal(c.sales,'0.00');assert.equal(c.net,'-3.00');
 assert.deepEqual(c.groups,{'Продвижение и реклама':'-1.01','Услуги доставки':'-2.02','Неизвестная услуга':'0.03'});assert.equal(common.rows,2);assert.equal(common.net,'-8.09');assert.equal(day.net,'1.25');
 assert.equal(validateOzonModel(model,{sales_amount:'12.34',transfer_total:'5.30',ads_spend:'4.05',bought_qty:0}),true);
});

test('writer resolves later or recovered product names without sharing mutable day and month buckets',()=>{
 const model=modelBuilder.create({from:'2026-10-10',to:'2026-10-11',declared:true});
 modelBuilder.add(model,{...sale('2026-10-10','A','10.00'),name:''});modelBuilder.add(model,{...refund('2026-10-11','a','-5.00'),name:'Название из следующего дня'});
 modelBuilder.add(model,{...sale('2026-10-10','B','20.00'),name:''});
 const snapshot=JSON.parse(JSON.stringify(modelBuilder.finish(model,new Map([['B','Восстановленное название']]))));
 assert.equal(snapshot.days['2026-10-10'].products.find(p=>p.article==='A').name,'Название из следующего дня');assert.equal(snapshot.days['2026-10-10'].products.find(p=>p.article==='B').name,'Восстановленное название');
 snapshot.days['2026-10-10'].products[0].groups.changed='999.00';assert.equal(snapshot.products[0].groups.changed,undefined);
 const finishAgain=JSON.parse(JSON.stringify(modelBuilder.finish(model)));assert.equal(finishAgain.days['2026-10-10'].products[0].groups.changed,undefined);assert.equal(finishAgain.days['2026-10-10'].products[0].sales,'10.00');assert.equal(finishAgain.products[0].sales,'5.00');
});

test('expanded daily ledgers preserve calculateOzonDaily, COGS and monthly version-1 results',()=>{
 const source=imported('2026-10',octoberRows),legacy=structuredClone(source.snapshot.model);
 for(const day of Object.values(legacy.days))day.products=day.products.filter(p=>p.quantity!==0).map(({article,quantity})=>({article,quantity}));
 const prices=costCatalogue([{article:'A',cost_price:'100.00'},{article:'B',cost_price:'40.00'}]),expanded=calculateOzonDaily(source.snapshot.model,source.report,prices,'6.00'),old=calculateOzonDaily(legacy,source.report,prices,'6.00');
 assert.equal(expanded.status,'ready');assert.deepEqual(expanded,old);assert.equal(expanded.days.find(d=>d.date==='2026-10-11').cogs,'-100.00');
 assert.deepEqual(calculateOzonUnit(source.snapshot.model,source.report,prices,'6.00'),calculateOzonUnit(legacy,source.report,prices,'6.00'));
 assert.deepEqual(calculateOzonDaily(source.snapshot.model,source.report,new Map(),'6.00'),calculateOzonDaily(legacy,source.report,new Map(),'6.00'),'unknown costs remain unknown with either stored shape');
});

test('writer aggregates repeated cent amounts without retaining operation IDs or original rows',()=>{
 const base={...sale('2026-10-10','A','0.01'),order_id:'SYNTHETIC_PRIVATE_ORDER',posting_number:'SYNTHETIC_PRIVATE_POSTING',operation_id:'SYNTHETIC_PRIVATE_OPERATION'},small=build([base],{from:'2026-10-10',to:'2026-10-10',declared:true}),large=build(Array.from({length:5000},()=>base),small.coverage),json=JSON.stringify(large);
 assert.equal(large.totals.sales,'50.00');assert.equal(large.days['2026-10-10'].products.length,1);assert.equal(large.days['2026-10-10'].products[0].rows,5000);assert.equal(large.days['2026-10-10'].products[0].sales,'50.00');
 assert.ok(json.length<JSON.stringify(small).length+100,'storage grows with day/SKU buckets, not the number of accrual rows');assert.doesNotMatch(json,/order_id|posting_number|operation_id|SYNTHETIC_PRIVATE/);
});

async function parseSyntheticAccruals(rows,declared){
 const header=['Дата начисления','Группа услуг','Тип начисления','Артикул','SKU','Название товара','Количество','Цена продавца','Сумма итого, руб.','Схема работы','Дата заказа','ID начисления','Номер отправления'];
 const aoa=[...(declared?[[declared]]:[]),header,...rows.map((r,i)=>[r.date,r.group,r.type||'',r.article,'',r.name||'Товар '+r.article,r.quantity,'999999.99',r.amount,i%2?'FBO':'FBS','2024-01-01','SYNTHETIC_PRIVATE_OPERATION_'+i,'SYNTHETIC_PRIVATE_POSTING_'+i])];
 const sheet={},workbook={SheetNames:['Начисления'],Sheets:{Начисления:sheet}},app={XLSX:{read(buffer,options){assert.ok(buffer instanceof ArrayBuffer);assert.equal(options.type,'array');return workbook;},utils:{sheet_to_json(value,options){assert.equal(value,sheet);assert.equal(options.header,1);return aoa;}}}};
 // Only workbook decoding is supplied in memory. Run the current production
 // parser and writer unchanged; loading libraries or making requests fails.
 const context={window:app,Map,BigInt,Number,Date,document:{createElement(){throw Error('Synthetic parser tests must not load external libraries');}},fetch(){throw Error('No network calls in synthetic parser tests');}};
 vm.runInNewContext(readFileSync(new URL('../assets/ozon-model.js',import.meta.url),'utf8'),context);
 vm.runInNewContext(readFileSync(new URL('../assets/parse.js',import.meta.url),'utf8'),context);
 return JSON.parse(JSON.stringify(await app.WBParse.parseOzonAccruals({name:'synthetic-ozon.xlsx',arrayBuffer:async()=>new ArrayBuffer(0)})));
}
const parsedImports=parsed=>parsed.periods.map(p=>({snapshot:{shop_id:shopId,month:`${p.report.year}-${String(p.report.month).padStart(2,'0')}-01`,model:p.analytics},report:{...p.report,shop_id:shopId,marketplace:'ozon',operational_expenses:'123.45',external_promotion_expenses:'67.89'}}));

test('real Ozon parser -> current writer -> exact range reader works after reupload without enriching the model',async()=>{
 const parsed=await parseSyntheticAccruals(octoberRows,'01.10.2026 - 31.10.2026');assert.equal(parsed.transactionCount,octoberRows.length);assert.equal(parsed.periods.length,1);
 const p=parsed.periods[0];assert.equal(p.analytics.version,1);assert.equal(validateOzonModel(p.analytics,p.report),true);assert.equal(p.analytics.days['2026-10-10'].products.find(p=>p.article==='A').sales,'1000.00');
 const period={dateFrom:'2026-10-10',dateTo:'2026-10-11'},f=client(parsedImports(parsed)),r=await read(f,'2026-10','2026-10',period);
 assert.equal(r.status,'ready');assert.deepEqual(r.period,period);assert.equal(r.totals.sales,'700.00');assert.equal(r.totals.net_profit,'353.00');assert.equal(r.totals.internal_ads,'30.00');assert.equal(product(r,'A').net_profit,'215.00');assert.equal(product(r,'B').net_profit,'138.00');assert.equal(expense(r,'internal').amount,'70.00');assert.equal(expense(r,'operating').amount,null);
 assert.doesNotMatch(JSON.stringify(p.analytics),/SYNTHETIC_PRIVATE|order_id|posting_number|operation_id|Дата заказа|ID начисления/);assert.doesNotMatch(JSON.stringify(r),/orders_amount|orders_count|placed_orders/);balanced(r);scoped(f);
});

test('real parser splits cross-month accruals and preserves partial coverage, dated refunds and expense-only days',async()=>{
 const rows=[sale('2026-09-30','A','100.00'),fee('2026-09-30','A','-10.00','Вознаграждение Ozon'),refund('2026-10-01','a','-40.00'),fee('2026-10-01','A','2.00'),fee('2026-10-02','C','-5.00','Продвижение и реклама')],parsed=await parseSyntheticAccruals(rows,'30.09.2026 - 02.10.2026');
 assert.equal(parsed.periods.length,2);assert.deepEqual(parsed.periods.map(p=>p.analytics.coverage),[{from:'2026-09-30',to:'2026-09-30',declared:true},{from:'2026-10-01',to:'2026-10-02',declared:true}]);
 for(const p of parsed.periods)assert.equal(validateOzonModel(p.analytics,p.report),true);
 const imports=parsedImports(parsed),period={dateFrom:'2026-09-30',dateTo:'2026-10-01'},r=await read(client(imports,{prices:[{article:'A',cost_price:'20.00'}]}),'2026-09','2026-10',period);
 assert.equal(r.status,'ready');assert.deepEqual(r.period,period);assert.equal(r.products.length,1);assert.equal(product(r,'A').quantity,0);assert.equal(product(r,'A').tax,'3.60');assert.equal(r.totals.sales,'60.00');assert.equal(r.totals.net_profit,'48.40');balanced(r);
 const october=parsed.periods[1],daily=calculateOzonDaily(october.analytics,october.report,costCatalogue([{article:'A',cost_price:'20.00'}]),'6.00');assert.equal(daily.status,'ready');assert.equal(daily.days[0].cogs,'-20.00');assert.equal(daily.days[1].cogs,'0.00');assert.equal(daily.days[1].net_profit,'-5.00');
 const adsOnly=await read(client(imports),'2026-10','2026-10',{dateFrom:'2026-10-02',dateTo:'2026-10-02'});assert.equal(adsOnly.status,'ready');assert.equal(adsOnly.products.length,1);assert.equal(product(adsOnly,'C').internal_ads,'5.00');assert.equal(product(adsOnly,'C').quantity,0);assert.equal(product(adsOnly,'C').net_profit,'-5.00');balanced(adsOnly);
});

test('parser without declared dates exposes only the actual accrual span and supports known empty interior days',async()=>{
 const parsed=await parseSyntheticAccruals([sale('2026-10-10','A','100.00'),refund('2026-10-20','A','-50.00')]),imports=parsedImports(parsed),period={dateFrom:'2026-10-15',dateTo:'2026-10-15'};
 assert.deepEqual(parsed.periods[0].analytics.coverage,{from:'2026-10-10',to:'2026-10-20',declared:false});
 const r=await read(client(imports),'2026-10','2026-10',period);assert.equal(r.status,'ready');assert.deepEqual(r.period,period);assert.deepEqual(r.products,[]);assert.equal(r.totals.sales,'0.00');
 assert.equal((await read(client(imports),'2026-10','2026-10',{dateFrom:'2026-10-09',dateTo:'2026-10-20'})).status,'needs_import');
});
