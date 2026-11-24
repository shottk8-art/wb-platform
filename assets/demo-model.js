/* Fictional, deterministic workspace. No accounts, storage or service calls. */
(function(root){
  'use strict';
  const DAY=86400000,iso=d=>d.toISOString().slice(0,10),key=p=>`${p.year}-${String(p.month).padStart(2,'0')}`;
  const cents=n=>Math.round(Number(n||0)*100),rub=n=>(n/100).toFixed(2),sum=(rows,k)=>rows.reduce((n,r)=>n+(r[k]||0),0);
  const add=(d,n)=>iso(new Date(Date.parse(d+'T00:00:00Z')+n*DAY));
  const monthEnd=m=>iso(new Date(Date.UTC(+m.slice(0,4),+m.slice(5,7),0)));
  const previousMonth=m=>iso(new Date(Date.UTC(+m.slice(0,4),+m.slice(5,7)-2,1))).slice(0,7);
  const change=(a,b)=>({amount:rub(cents(a)-cents(b)),percent:Number(b)===0?null:(Number(a)-Number(b))/Math.abs(Number(b))*100});
  const ratio=(a,b)=>b>0?a/b*100:null;
  const catalogue=[
    {article:'serum',name:'Сыворотка для лица',price:1290,cost:310,quantity:140},
    {article:'cream',name:'Крем для рук',price:690,cost:155,quantity:190},
    {article:'cleanser',name:'Гель для умывания',price:890,cost:210,quantity:120},
    {article:'mask',name:'Маска для лица',price:450,cost:275,quantity:150},
    {article:'toner',name:'Увлажняющий тоник',price:990,cost:240,quantity:90},
    {article:'balm',name:'Бальзам для губ',price:390,cost:85,quantity:180},
  ];
  const fees=[['commission','Комиссия маркетплейса'],['logistics','Логистика'],['storage','Хранение'],['acceptance','Приёмка'],['internal','Внутренняя реклама']];
  function distribute(total,weights){
    const denominator=weights.reduce((a,b)=>a+b,0),raw=weights.map(w=>total*w/denominator),out=raw.map(Math.floor);
    const order=raw.map((n,i)=>({i,f:n-out[i]})).sort((a,b)=>b.f-a.f||a.i-b.i);
    for(let n=total-out.reduce((a,b)=>a+b,0),i=0;i<n;i++)out[order[i].i]++;
    return out;
  }
  function create(anchor=new Date()){
    const today=iso(new Date(anchor.getTime()+3*3600000)),current=today.slice(0,7),date=new Date(today+'T00:00:00Z');
    const periods=Array.from({length:13},(_,i)=>{const d=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()-12+i,1));return {year:d.getUTCFullYear(),month:d.getUTCMonth()+1};});
    const state={name:'NOVALAB · демомагазин',taxRate:6,costs:new Map(catalogue.map(p=>[p.article,p.cost])),manual:new Map(),excluded:new Set(['balm']),removedReports:new Set(),alertDays:14,targetDays:30};
    const members=[{id:1,username:'demo_anna',joined:true},{id:2,username:'demo_ivan',joined:false}];
    const cache=new Map();
    const end=m=>m===current?today:monthEnd(m);
    const available=(marketplace='wildberries')=>periods.slice(1).filter(p=>marketplace==='wildberries'||!state.removedReports.has(key(p)));
    function month(m,marketplace='wildberries'){
      const id=marketplace+':'+m;if(cache.has(id))return cache.get(id);
      const index=periods.findIndex(p=>key(p)===m);if(index<0)return null;
      const dateTo=end(m),length=+dateTo.slice(-2),allDays=+monthEnd(m).slice(-2),partial=length<allDays;
      const days=Array.from({length},(_,i)=>({date:m+'-'+String(i+1).padStart(2,'0'),entries:[],media:0}));
      catalogue.forEach((p,j)=>{
        const factor=(marketplace==='ozon'?.62:1)*(1+index*.035+Math.sin(index*.7)*.08);
        const total=Math.round(p.quantity*factor*(1+Math.sin(index+j)*.07)*(partial?length/allDays:1));
        const quantities=distribute(total,days.map((d,i)=>1.1+Math.sin((i+j)*.8)*.25+([0,6].includes(new Date(d.date+'T12:00:00Z').getUTCDay())?.3:0)));
        days.forEach((d,i)=>{
          const quantity=quantities[i],sales=quantity*p.price*100;
          const entry={article:p.article,name:p.name,quantity,sales,cogs:quantity*cents(state.costs.get(p.article)),commission:Math.round(sales*.17),logistics:Math.round(sales*.067),storage:Math.round(sales*.012),acceptance:Math.round(sales*.006),internal:Math.round(sales*(p.article==='mask'?.20:.075)),tax:Math.round(sales*state.taxRate/100)};
          entry.expenses=entry.cogs+entry.tax+fees.reduce((n,[k])=>n+entry[k],0);entry.profit=sales-entry.expenses;d.entries.push(entry);
        });
      });
      for(const d of days){d.sales=sum(d.entries,'sales');d.quantity=sum(d.entries,'quantity');d.media=marketplace==='ozon'?0:Math.round(d.sales*.012);d.profit=sum(d.entries,'profit')-d.media;}
      const totals={};for(const k of ['sales','quantity','cogs','commission','logistics','storage','acceptance','internal','tax','expenses','profit'])totals[k]=days.reduce((n,d)=>n+sum(d.entries,k),0);
      totals.media=sum(days,'media');
      const manual=state.manual.get(marketplace+':'+m)||{operational:12000,external:5000};
      const report={...periods[index],marketplace,sales_amount:totals.sales/100,orders_amount:marketplace==='ozon'?null:Math.round(totals.sales/100*1.32),bought_qty:totals.quantity,
        transfer_goods:(totals.sales-totals.commission)/100,transfer_total:(totals.sales-totals.commission-totals.logistics-totals.storage-totals.acceptance)/100,
        delivery_cost:totals.logistics/100,storage_cost:totals.storage/100,acceptance_ops:totals.acceptance/100,fines:0,other_fees:0,
        ads_spend:totals.internal/100,wb_media_spend:totals.media/100,ads_promo_spend:marketplace==='wildberries'&&index%3===0?2000:0,
        operational_expenses:manual.operational,external_promotion_expenses:manual.external};
      const skus=catalogue.map(p=>({article:p.article,name:p.name,marketplace,bought_qty:days.reduce((n,d)=>n+d.entries.find(e=>e.article===p.article).quantity,0),revenue:days.reduce((n,d)=>n+d.entries.find(e=>e.article===p.article).sales,0)/100}));
      const result={period:periods[index],report,skus,days,totals,partial};cache.set(id,result);return result;
    }
    function daysIn(from,to,marketplace){
      const rows=[],missing=[];
      for(let d=from;d<=to;d=add(d,1)){
        const source=month(d.slice(0,7),marketplace),day=source?.days.find(r=>r.date===d);
        if(!day||marketplace==='ozon'&&state.removedReports.has(d.slice(0,7)))missing.push(d);else rows.push(day);
      }
      return {rows,missing};
    }
    function dayRow(d){
      const totals={};for(const k of ['sales','quantity','cogs','tax','internal'])totals[k]=sum(d.entries,k);
      const expenses=[...fees.filter(([k])=>k!=='internal').map(([k,label])=>({key:k,label,amount:rub(sum(d.entries,k))})),{key:'internal',label:'Внутренняя реклама',amount:rub(totals.internal)},{key:'media',label:'Медийная реклама',amount:rub(d.media)},{key:'cogs',label:'Себестоимость',amount:rub(totals.cogs)},{key:'tax',label:'Налог с продаж',amount:rub(totals.tax)}];
      return {date:d.date,rows:d.entries.length,sales:rub(totals.sales),quantity:totals.quantity,cogs:rub(totals.cogs),tax:rub(totals.tax),internal_ads:rub(totals.internal),media_ads:rub(d.media),promo:'0.00',expenses,net_profit:rub(d.profit),missing:[],missing_costs:[],allocated:false};
    }
    function daily(m,marketplace='wildberries'){
      const source=month(m,marketplace);
      if(!source||marketplace==='ozon'&&state.removedReports.has(m))return {status:'needs_import',days:[],message:'Добавьте пример отчёта Ozon за этот месяц в разделе «Отчёты».'};
      const before=month(previousMonth(m),marketplace),cut=before?.days.slice(0,source.partial?source.days.length:undefined),days=source.days.map(dayRow);
      let cumulative=0;
      days.forEach((d,i)=>{
        cumulative+=source.days[i].profit;d.cumulative_profit=rub(cumulative);
        const prior=cut?.find(p=>+p.date.slice(-2)===i+1),yesterday=i?source.days[i-1]:before?.days.at(-1);
        d.previous_period={date:prior?.date||null,profit:prior?rub(prior.profit):null,change:prior?change(d.net_profit,rub(prior.profit)):null,calendar_gap:!prior};
        d.previous_day=yesterday?{date:yesterday.date,profit:rub(yesterday.profit),change:change(d.net_profit,rub(yesterday.profit))}:null;
      });
      const profit=sum(source.days,'profit'),comparison=cut?.length?{status:'ready',period:{dateFrom:cut[0].date,dateTo:cut.at(-1).date},monthly_profit:rub(sum(cut,'profit')),change:change(rub(profit),rub(sum(cut,'profit'))),average:sum(cut,'profit')/100/cut.length,positive_days:cut.filter(d=>d.profit>0).length}: {status:'outside_history',period:{dateFrom:previousMonth(m)+'-01',dateTo:monthEnd(previousMonth(m))}};
      return {status:'ready',period:{dateFrom:m+'-01',dateTo:end(m)},days,monthly_profit:rub(profit),comparison,unallocated:null,refreshing:false,media_estimated:false,updated_at:anchor.toISOString(),excluded_expenses:['operational_expenses','external_promotion_expenses']};
    }
    function unit(from,to,marketplace='wildberries'){
      const {rows,missing}=daysIn(from,to,marketplace);
      if(missing.length)return {status:'needs_import',products:[],message:'Для выбранных дат нужен пример отчёта Ozon. Добавьте его в разделе «Отчёты».'};
      const products=catalogue.map(p=>{
        const entries=rows.flatMap(d=>d.entries.filter(e=>e.article===p.article)),totals={};
        for(const k of ['sales','quantity','cogs','tax','internal','commission','logistics','storage','acceptance','expenses','profit'])totals[k]=sum(entries,k);
        return {article:p.article,name:p.name,quantity:totals.quantity,sales:rub(totals.sales),cost_price:state.costs.get(p.article),net_profit:rub(totals.profit),total_expenses:rub(totals.expenses),internal_ads:rub(totals.internal),drr:ratio(totals.internal,totals.sales),margin:ratio(totals.profit,totals.sales),profitability:ratio(totals.profit,totals.expenses),missing_costs:false,
          expenses:[...fees.map(([k,label])=>({key:k,label,amount:rub(totals[k])})),{key:'cogs',label:'Себестоимость',amount:rub(totals.cogs)},{key:'tax',label:'Налог с продаж',amount:rub(totals.tax)}]};
      });
      const months=[...new Set(rows.map(d=>d.date.slice(0,7)))],partial=months.some(m=>from>m+'-01'||to<monthEnd(m));
      const totals={};for(const k of ['sales','total_expenses','net_profit','internal_ads'])totals[k==='total_expenses'?'expenses':k]=rub(products.reduce((n,p)=>n+cents(p[k]),0));
      totals.margin=ratio(cents(totals.net_profit),cents(totals.sales));totals.profitability=ratio(cents(totals.net_profit),cents(totals.expenses));totals.drr=ratio(cents(totals.internal_ads),cents(totals.sales));
      return {status:'ready',method:'direct_only',products,totals,period:{dateFrom:from,dateTo:to},months,common_expenses:[{key:'media',label:'Медийная реклама магазина',amount:rub(sum(rows,'media'))},...['operational','external'].map((k,i)=>({key:k,label:i?'Внешнее продвижение':'Операционные расходы',amount:partial?null:rub(months.reduce((n,m)=>n+cents((state.manual.get(marketplace+':'+m)||{operational:12000,external:5000})[k]),0)),excluded:partial}))],excluded_expenses:partial?['operational','external']:[],updated_at:anchor.toISOString()};
    }
    function stocks(){
      const warehouses=[{id:'wb-kazan',name:'Казань',kind:'wb',region:'Татарстан'},{id:'wb-elektro',name:'Электросталь',kind:'wb',region:'Московская область'},{id:'fbs',name:'Склад продавца',kind:'seller'}];
      const quantities=[12,0,180,62,19,360],last=month(key(periods.at(-2))),demandDays=last.days.length;
      const products=catalogue.map((p,i)=>{
        const quantity=quantities[i],orders=Math.round(last.skus[i].bought_qty*1.32),daily_orders=orders/demandDays,days_left=quantity/daily_orders,excluded=state.excluded.has(p.article);
        const counts=distribute(quantity,[.55,.30,.15]);
        return {nm_id:String(90000001+i),article:p.article,name:p.name,quantity,wb:counts[0]+counts[1],seller:counts[2],to_client:8+i,from_client:i,orders,daily_orders,days_left,status:quantity===0?'out':days_left<=state.alertDays?'low':'ok',recommended:Math.max(0,Math.ceil(daily_orders*state.targetDays-quantity)),excluded,
          warehouses:warehouses.map((w,j)=>({id:w.id,quantity:counts[j],to_client:j===0?8+i:0,from_client:j===0?i:0,sizes:[]}))};
      });
      const tracked=products.filter(p=>!p.excluded);
      return {status:'ready',fetched_at:anchor.toISOString(),stale:false,error:null,settings:{alert_days:state.alertDays,target_days:state.targetDays},inventory:{products,warehouses,demand:{from:key(periods.at(-2))+'-01',to:monthEnd(key(periods.at(-2))),days:demandDays},totals:{products:tracked.length,quantity:sum(tracked,'quantity'),warehouses:warehouses.length,out:tracked.filter(p=>p.status==='out').length,low:tracked.filter(p=>p.status==='low').length,unknown:0,excluded:products.length-tracked.length}}};
    }
    const codes=[{id:'demo-promo-01',name:'Первый заказ',code:'HELLO10'},{id:'demo-promo-02',name:'Уход за собой',code:'CARE15'},{id:'demo-promo-03',name:'Набор недели',code:'WEEK10'},{id:'demo-promo-04',name:'Друзья бренда',code:'FRIENDS'}];
    function promos(from,to){
      const rows=codes.map((p,i)=>({...p,quantity:0,sales:0,returns:0,net:0}));
      for(const d of daysIn(from,to,'wildberries').rows)for(const [i,p] of rows.entries()){
        const entries=d.entries.slice(i,i+2),quantity=Math.floor(sum(entries,'quantity')*(.42-i*.05)),avg=sum(entries,'quantity')?sum(entries,'sales')/sum(entries,'quantity')*.91:0;
        const amount=Math.round(quantity*avg),returned=quantity>2&&(+d.date.slice(-2)+i)%17===0?1:0;
        p.quantity+=quantity;p.sales+=amount;p.returns+=Math.round(returned*avg);
      }
      rows.forEach(p=>p.net=p.sales-p.returns);
      return {rows,totals:{active:rows.filter(p=>p.quantity>0).length,quantity:sum(rows,'quantity'),sales:sum(rows,'sales'),net:sum(rows,'net')}};
    }
    function setCost(article,value){if(!state.costs.has(article)||!Number.isFinite(Number(value))||Number(value)<0)throw Error('Укажите себестоимость от 0 ₽');state.costs.set(article,Number(value));cache.clear();}
    function setTax(value){if(!Number.isInteger(Number(value))||Number(value)<0||Number(value)>100)throw Error('Укажите целый процент от 0 до 100');state.taxRate=Number(value);cache.clear();}
    function setManual(m,marketplace,operational,external){if([operational,external].some(v=>!Number.isFinite(Number(v))||Number(v)<0))throw Error('Расходы должны быть неотрицательными');state.manual.set(marketplace+':'+m,{operational:Number(operational),external:Number(external)});cache.clear();}
    return {today,current,periods,catalogue,state,members,available,month,daily,unit,stocks,promos,setCost,setTax,setManual,monthEnd,end,change,key,add};
  }
  const api={create};if(typeof module==='object'&&module.exports)module.exports=api;else root.WBDemoModel=api;
})(typeof window==='object'?window:globalThis);
