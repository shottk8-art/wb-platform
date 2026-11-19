(function(root){
  'use strict';
  const DAY=86400000,iso=d=>d.toISOString().slice(0,10),serial=d=>+d.slice(0,4)*12+ +d.slice(5,7)-1;
  const first=n=>iso(new Date(Date.UTC(Math.floor(n/12),n%12,1))),last=n=>iso(new Date(Date.UTC(Math.floor((n+1)/12),(n+1)%12,0)));
  const add=(d,n)=>iso(new Date(Date.parse(d+'T00:00:00Z')+n*DAY));
  const today=()=>iso(new Date(Date.now()+10800000));
  const valid=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&iso(new Date(d+'T00:00:00Z'))===d;
  function months(from,to){const out=[];if(!valid(from)||!valid(to)||from>to)throw Error('Выберите корректные даты периода');for(let m=serial(from);m<=serial(to);m++){out.push(first(m).slice(0,7));if(out.length>36)throw Error('Выберите период до 36 месяцев');}return out;}
  function bounds(available,now=today()){
    if(Array.isArray(available)&&available.length){const all=[...available].sort();return {min:all[0]+'-01',max:[last(serial(all.at(-1))),now].sort()[0]};}
    return {min:first(serial(now)-11),max:now};
  }
  function normalize(from,to,now=today()){
    const a=/^\d{4}-\d{2}$/.test(from||'')?from+'-01':from,b=/^\d{4}-\d{2}$/.test(to||'')?[last(serial(to)),now].sort()[0]:to;
    months(a,b);return {from:a,to:b};
  }
  function previous(from,to){const full=from.endsWith('-01')&&to===last(serial(to)),count=serial(to)-serial(from)+1,len=Math.round((Date.parse(to)-Date.parse(from))/DAY)+1;
    return {dateFrom:full?first(serial(from)-count):add(from,-len),dateTo:add(from,-1),calendarMonths:full?count:0};}
  const cents=value=>{const m=/^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));if(!m)throw Error('Некорректная сумма в ежедневной аналитике');return (m[1]?-1n:1n)*(BigInt(m[2])*100n+BigInt((m[3]||'').padEnd(2,'0')));};
  const rub=v=>(v<0n?'-':'')+(v<0n?-v:v)/100n+'.'+String((v<0n?-v:v)%100n).padStart(2,'0');
  const sum=values=>values.some(v=>v==null)?null:rub(values.reduce((n,v)=>n+cents(v),0n));
  const change=(now,before)=>now==null||before==null?null:{amount:rub(cents(now)-cents(before)),percent:cents(before)===0n?null:Number(cents(now)-cents(before))/Math.abs(Number(cents(before)))*100};
  function selected(sources,from,to){
    const rows=new Map(),unallocated=[];let refreshing=false,estimated=false;
    for(const source of sources){for(const row of source.days||[])rows.set(row.date,row);if(source.unallocated)unallocated.push(source);refreshing ||=!!source.refreshing;estimated ||=!!source.media_estimated;}
    const days=[],missing=[];for(let date=from;date<=to;date=add(date,1)){if(!rows.has(date))missing.push(date);else days.push({...rows.get(date)});}
    if(missing.length)return {missing};
    let total=sum(days.map(d=>d.net_profit)),notice='',unknown=false;
    for(const source of unallocated){if(from<=source.period.dateFrom&&to>=source.period.dateTo)total=sum([total,source.unallocated.net_profit]);else{unknown=true;total=null;}}
    if(unknown)notice='В выгрузке есть операции без даты. Их нельзя точно отнести к выбранным дням, поэтому итог прибыли за период пока не определён.';
    let running=0n,known=true;for(const day of days){if(day.net_profit==null)known=false;else running+=cents(day.net_profit);day.cumulative_profit=known?rub(running):null;}
    return {days,total,rows,refreshing,estimated,notice,unallocated};
  }
  async function load({from,to,read,isCurrent=()=>true,min,marketplace='wildberries',defaultCoverage=false}){
    const selectedMonths=months(from,to),cache=new Map();
    const get=month=>{if(!isCurrent())throw Error('Выбор периода изменился');if(!cache.has(month))cache.set(month,Promise.resolve(read(month)));return cache.get(month);};
    const original=await get(selectedMonths[0]);if(!isCurrent())return null;
    if(selectedMonths.length===1&&(defaultCoverage||original.status==='ready'&&original.period?.dateFrom===from&&original.period?.dateTo===to))return original;
    const old=previous(from,to),outside=!!min&&old.dateFrom<min,priorMonths=outside?[]:months(old.dateFrom,old.dateTo),all=[...new Set([...selectedMonths,...priorMonths])];
    for(let i=0;i<all.length;i+=3){if(!isCurrent())return null;await Promise.all(all.slice(i,i+3).map(get));}
    if(!isCurrent())return null;
    const byMonth=new Map();for(const m of all)byMonth.set(m,await get(m));
    const pending=selectedMonths.filter(m=>byMonth.get(m).status!=='ready').map(m=>({month:m,status:byMonth.get(m).status,error:byMonth.get(m).refresh_error}));
    if(pending.length)return {status:pending.some(p=>p.status==='loading')?'loading':marketplace==='ozon'?'needs_import':'needs_preparation',pending,period:{dateFrom:from,dateTo:to},days:[],message:'Для выбранных дат нужны полные ежедневные данные. Подготовьте указанные месяцы.'};
    const sources=selectedMonths.map(m=>byMonth.get(m)),current=selected(sources,from,to);
    if(current.missing)return {status:marketplace==='ozon'?'needs_import':'needs_preparation',pending:[...new Set(current.missing.map(d=>d.slice(0,7)))].map(month=>({month,status:'needs_preparation'})),period:{dateFrom:from,dateTo:to},days:[],message:'Выбранные даты не полностью покрыты загруженными отчётами.'};
    const priorPending=priorMonths.filter(m=>byMonth.get(m).status!=='ready').map(m=>({month:m,status:byMonth.get(m).status}));
    let before=outside||priorPending.length?null:selected(priorMonths.map(m=>byMonth.get(m)),old.dateFrom,old.dateTo);
    if(before?.missing){for(const month of new Set(before.missing.map(d=>d.slice(0,7))))priorPending.push({month,status:'needs_preparation'});before=null;}
    const comparison={status:outside?'outside_history':before?'ready':priorPending.some(p=>p.status==='loading')?'loading':'needs_preparation',period:{dateFrom:old.dateFrom,dateTo:old.dateTo},pending:priorPending,month:priorPending[0]?.month,refreshing:!!before?.refreshing};
    if(before){comparison.monthly_profit=before.total;comparison.change=change(current.total,before.total);comparison.average=before.days.every(d=>d.net_profit!=null)?Number(sum(before.days.map(d=>d.net_profit)))/before.days.length:null;comparison.positive_days=before.days.every(d=>d.net_profit!=null)?before.days.filter(d=>Number(d.net_profit)>0).length:null;comparison.media_estimated=before.estimated;}
    else comparison.error=outside?'Предыдущий период выходит за доступную историю.':'Для сравнения нужны ежедневные данные предыдущего периода.';
    current.days.forEach((row,i)=>{
      let date=add(old.dateFrom,i),gap=false;
      if(old.calendarMonths){const m=serial(row.date)-old.calendarMonths,dateDay=+row.date.slice(-2);gap=dateDay>+last(m).slice(-2);date=first(m).slice(0,8)+String(dateDay).padStart(2,'0');}
      const previousDay=current.rows.get(add(row.date,-1))||before?.rows.get(add(row.date,-1));
      row.previous_day=previousDay?{date:previousDay.date,profit:previousDay.net_profit,change:change(row.net_profit,previousDay.net_profit)}:null;
      const prior=gap?null:before?.rows.get(date);row.previous_period={date:gap?null:date,profit:prior?.net_profit??null,calendar_gap:gap,change:change(row.net_profit,prior?.net_profit)};
    });
    const updated=sources.map(s=>s.updated_at).filter(Boolean).sort()[0]||null;
    const ledger=new Map();for(const source of current.unallocated)for(const e of source.unallocated.expenses||[]){const key=e.key||e.label,old=ledger.get(key);ledger.set(key,old?{...e,amount:sum([old.amount,e.amount])}:{...e});}
    const unallocated=current.unallocated.length?{date:'unallocated',net_profit:sum(current.unallocated.map(s=>s.unallocated.net_profit)),expenses:[...ledger.values()],missing:current.notice?[current.notice]:[],rows:0}:null;
    return {status:'ready',marketplace,period:{dateFrom:from,dateTo:to},days:current.days,monthly_profit:current.total,comparison,unallocated,unallocated_notice:current.notice,refreshing:current.refreshing,media_estimated:current.estimated,updated_at:updated,refresh_error:sources.find(s=>s.refresh_error)?.refresh_error||null,range:true};
  }
  const api={today,valid,serial,first,last,add,months,bounds,normalize,previous,load};
  if(typeof module==='object'&&module.exports)module.exports=api;root.WBDayRange=api;
})(typeof window==='undefined'?globalThis:window);
