// Read-only period analytics. Existing monthly calculations remain authoritative.
(function () {
  const key = p => `${p.year}-${p.month}`;
  function serial(value) {
    const match=/^(\d{4})-(\d{1,2})$/.exec(String(value));
    if(!match || +match[1]<2000 || +match[1]>2100 || +match[2]<1 || +match[2]>12) throw new Error('Выберите месяц начала и окончания');
    return +match[1]*12+(+match[2]-1);
  }
  const period = n => ({year:Math.floor(n/12),month:n%12+1});
  function months(start,end) {
    const a=serial(start),b=serial(end);
    if(a>b) throw new Error('Начало периода не может быть позже окончания');
    return Array.from({length:b-a+1},(_,i)=>period(a+i));
  }
  function comparison(start,end) {
    const size=serial(end)-serial(start)+1;
    if(size<1) throw new Error('Некорректный период');
    return months(key(period(serial(start)-size)),key(period(serial(start)-1)));
  }
  const sum = values => values.every(Number.isFinite) ? Math.round(values.reduce((a,b)=>a+b,0)*100)/100 : null;
  function aggregate(entries) {
    if(!entries.length) return window.WBDashboard.fromApiCabinet(null);
    const output={rep:{},skuRows:[],expenses:[],missing:[...new Set(entries.flatMap(e=>e.derived.missing || []))],missingCosts:entries.flatMap(e=>e.derived.missingCosts || []),isApi:entries.some(e=>e.derived.isApi)};
    const fields=new Set(entries.flatMap(e=>Object.keys(e.derived.rep).filter(k=>typeof e.derived.rep[k]==='number'||e.derived.rep[k]===null)));
    for(const field of fields) output.rep[field]=sum(entries.map(e=>Object.hasOwn(e.derived.rep,field)?e.derived.rep[field]:0));
    for(const field of ['commission','cogs','ads','tax','manualExpenses','netProfit']) output[field]=sum(entries.map(e=>e.derived[field]));
    const expenses=new Map(),products=new Map(),combined=new Set(entries.map(e=>e.marketplace)).size>1;
    for(const {derived:d,marketplace} of entries) {
      for(const [label,value] of window.WBDashboard.expenseItems(d,marketplace)) {
        const current=expenses.get(label) || [];
        current.push(value == null && !d.isApi ? 0 : value);expenses.set(label,current);
      }
      for(const row of d.skuRows) {
        const id=marketplace+':'+window.WBDashboard.articleKey(row.article);
        if(!products.has(id)) products.set(id,{...row,article:combined?`${marketplace==='ozon'?'Ozon':'WB'} · ${row.article}`:row.article,_rows:[]});
        products.get(id)._rows.push(row);
      }
    }
    output.expenses=[...expenses].map(([label,values])=>[label,sum(values)]);
    output.skuRows=[...products.values()].map(({_rows,...row})=>({...row,...Object.fromEntries(['bought_qty','revenue','total_cost','profit'].map(field=>[field,sum(_rows.map(r=>r[field]))]))})).sort((a,b)=>(b.bought_qty||0)-(a.bought_qty||0));
    let cumulative=0;const revenue=output.skuRows.reduce((n,r)=>n+Math.max(r.revenue||0,0),0);
    [...output.skuRows].sort((a,b)=>(b.revenue||0)-(a.revenue||0)).forEach(row=>{const before=revenue?cumulative/revenue:0;row.abc=before<.8?'A':before<.95?'B':'C';cumulative+=Math.max(row.revenue||0,0);});
    const advertising=sum([output.rep.ads_spend,output.rep.wb_media_spend,output.rep.external_promotion_expenses]);
    output.rates={drrOrders:advertising!=null && output.rep.orders_amount>0?advertising/output.rep.orders_amount*100:null,drrSales:advertising!=null && output.rep.sales_amount>0?advertising/output.rep.sales_amount*100:null};
    // Ozon accruals do not establish the amount of placed orders.
    if(entries.some(e=>e.marketplace==='ozon')) output.rates.drrOrders=null;
    return output;
  }
  function trendPoint(p,d) {
    return {...p,sales:d.rep.sales_amount,orders:d.rep.orders_amount,quantity:d.rep.bought_qty,transfer:d.rep.transfer_total,profit:d.netProfit,internalAds:d.rep.ads_spend,mediaAds:d.rep.wb_media_spend,promo:d.rep.ads_promo_spend,...d.rates};
  }
  async function mapBounded(items,callback) {
    const result=new Array(items.length);let next=0;
    await Promise.all(Array.from({length:Math.min(3,items.length)},async()=>{for(;;){const i=next++;if(i>=items.length)return;result[i]=await callback(items[i]);}}));
    return result;
  }
  async function load({shop,scope,api,start,end,isCurrent=()=>true}) {
    const selected=months(start,end),previous=comparison(start,end),all=[...previous,...selected];
    const marketplaces=scope==='all'?['wildberries','ozon']:[scope];
    const groups=await Promise.all(marketplaces.map(async marketplace=>{
      if(api && marketplace==='wildberries') {
        // Shared cabinet cache deduplicates neighbouring-month reads and history.
        const last=selected[selected.length-1],snapshot=await window.WBApiCabinet.overview(`${last.year}-${String(last.month).padStart(2,'0')}`);
        const ready=new Set((snapshot?.trend || []).map(key));
        if(snapshot?.cabinet?.complete)ready.add(key(last));
        const rows=await mapBounded(all,async p=>{
          if(!isCurrent() || !ready.has(key(p)))return [key(p),null];
          const snapshot=await window.WBApiCabinet.overview(`${p.year}-${String(p.month).padStart(2,'0')}`);
          return [key(p),snapshot?.cabinet?.complete ? {derived:window.WBDashboard.fromApiCabinet(snapshot.cabinet),marketplace}:null];
        });
        return new Map(rows.filter(Boolean));
      }
      const rows=await window.WBDashboard.loadPeriodRange(shop.id,all,marketplace);
      return new Map(all.map(p=>{const row=rows.get(key(p));return [key(p),row?.available && row.report ? {marketplace,derived:window.WBDashboard.computeDerived(row.report,row.skus,row.costMap,shop.tax_rate)}:null];}));
    }));
    if(!isCurrent()) return null;
    const missing=[];
    groups.forEach((rows,index)=>selected.forEach(p=>{if(!rows.get(key(p)))missing.push(`${marketplaces[index]==='ozon'?'Ozon':'WB'}: ${window.WBDashboard.formatPeriod(p.year,p.month)}`);}));
    if(missing.length) throw new Error('Не хватает полных данных — '+missing.slice(0,3).join(', ')+(missing.length>3?` и ещё ${missing.length-3} мес.`:'')+'. Загрузите отчёты или сократите диапазон.');
    const collect=list=>list.flatMap(p=>groups.map(rows=>rows.get(key(p))));
    const before=collect(previous),current=collect(selected);
    const partial=selected.some(p=>`${p.year}-${String(p.month).padStart(2,'0')}`===window.WBApiCabinet?.currentMonth);
    return {derived:aggregate(current),previous:!partial && before.every(Boolean)?aggregate(before):null,trend:selected.map(p=>trendPoint(p,aggregate(groups.map(rows=>rows.get(key(p)))))),selected,comparison:previous,partial};
  }

  let active=false,available=[];
  const el=id=>document.getElementById(id);
  function selectedMonths() {try{return active?months(el('periodStart').value,el('periodSelect').value).map(key):[];}catch{return [];}}
  function label(list) {if(!list?.length)return '';const first=list[0],last=list[list.length-1];return key(first)===key(last)?window.WBDashboard.formatPeriod(first.year,first.month):`${window.WBDashboard.formatPeriod(first.year,first.month)} — ${window.WBDashboard.formatPeriod(last.year,last.month)}`;}
  function selection(){return {start:el('periodStart').value,end:el('periodSelect').value};}
  function clamp(){if(active && el('periodStart').value && el('periodSelect').value && serial(el('periodStart').value)>serial(el('periodSelect').value))el('periodStart').value=el('periodSelect').value;window.WBShell?.components?.refreshSelects();}
  function sync(periods) {
    available=periods;
    const previous=el('periodStart').value,end=el('periodSelect').value;
    el('periodStart').innerHTML=periods.map(p=>`<option value="${key(p)}">${window.WBDashboard.formatPeriod(p.year,p.month)}</option>`).join('');
    const candidates=periods.filter(p=>end && serial(key(p))<=serial(end));
    el('periodStart').value=periods.some(p=>key(p)===previous)?previous:periods.length?key(candidates[Math.min(2,candidates.length-1)] || periods[0]):'';
    clamp();
  }
  function mode(enabled) {
    active=enabled;
    el('periodStartField').hidden=!active;el('periodEndLabel').hidden=!active;
    el('periodModeMonth').setAttribute('aria-pressed',String(!active));el('periodModeRange').setAttribute('aria-pressed',String(active));
    el('periodModeMonth').classList.toggle('active',!active);el('periodModeRange').classList.toggle('active',active);
    el('periodSelect').setAttribute('aria-label',active?'Конец периода':'Период отчёта');
    el('rangeNotice').hidden=!active;
    if(active)sync(available);
    window.WBShell?.components?.refreshSelects();
  }
  function wire(reload,changed) {
    for(const [id,value] of [['periodModeMonth',false],['periodModeRange',true]])el(id).addEventListener('click',()=>{if(active===value)return;mode(value);changed();reload();});
    el('periodStart').addEventListener('change',()=>{if(serial(el('periodStart').value)>serial(el('periodSelect').value))el('periodSelect').value=el('periodStart').value;clamp();reload();});
  }
  window.WBRange={months,comparison,aggregate,trendPoint,load,label,selection,selectedMonths,sync,clamp,wire,reset:()=>mode(false),get active(){return active;}};
})();
