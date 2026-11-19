// Compact accrual aggregates only: no order IDs or original report rows.
(function(){
  const key=v=>String(v??'').trim().toLowerCase();
  const cents=v=>{const n=typeof v==='number'?v:Number(String(v??'').replace(/\s/g,'').replace(',','.'));if(!Number.isFinite(n)||Math.abs(n)>1e12)throw Error('Некорректная сумма в отчёте Ozon');return BigInt(Math.round(n*100));};
  const rub=n=>`${n<0n?'-':''}${(n<0n?-n:n)/100n}.${String((n<0n?-n:n)%100n).padStart(2,'0')}`;
  const productBucket=(article,name)=>({article,name:name||'',rows:0,sales:0n,net:0n,quantity:0,groups:new Map()});
  function create(coverage){return {coverage,rows:0,sales:0n,net:0n,quantity:0,days:new Map(),products:new Map()};}
  function add(model,row){
    const amount=cents(row.amount),article=String(row.article||'').trim(),k=key(article),sale=row.group==='Продажи'||row.group==='Возвраты';
    const qty=row.type==='Выручка'?Number(row.quantity):row.type==='Возврат выручки'?-Math.abs(Number(row.quantity)):0;
    if(!Number.isSafeInteger(qty))throw Error('Некорректное количество в отчёте Ozon');
    const day=model.days.get(row.date)||{rows:0,sales:0n,net:0n,quantity:0,groups:new Map(),products:new Map()};
    const product=model.products.get(k)||productBucket(article,row.name),dailyProduct=day.products.get(k)||productBucket(article,row.name);
    // Each accrual updates its actual day and SKU, including expense-only and
    // unassigned rows. Keep daily and monthly buckets independent.
    for(const bucket of [model,day,product,dailyProduct]){bucket.rows++;bucket.net+=amount;if(sale){bucket.sales+=amount;bucket.quantity+=qty;}}
    for(const bucket of [day,product,dailyProduct])if(!sale)bucket.groups.set(row.group||'Другие начисления',(bucket.groups.get(row.group||'Другие начисления')||0n)+amount);
    for(const bucket of [product,dailyProduct])if(!bucket.name&&row.name)bucket.name=row.name;
    day.products.set(k,dailyProduct);
    model.days.set(row.date,day);model.products.set(k,product);
  }
  function finish(model,names=new Map()){
    const fields=b=>({rows:b.rows,sales:rub(b.sales),net:rub(b.net),quantity:b.quantity});
    const groups=g=>Object.fromEntries([...g].map(([k,v])=>[k,rub(v)]));
    const products=items=>[...items.values()].map(b=>({...fields(b),article:b.article,name:b.name||model.products.get(key(b.article))?.name||names.get(b.article)||'',groups:groups(b.groups)}));
    return {version:1,coverage:model.coverage,totals:fields(model),
      days:Object.fromEntries([...model.days].sort(([a],[b])=>a.localeCompare(b)).map(([date,b])=>[date,{...fields(b),groups:groups(b.groups),products:products(b.products)}])),
      products:products(model.products)};
  }
  function coverage(rows,year,month,dates){
    const first=`${year}-${String(month).padStart(2,'0')}-01`,last=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
    const parse=s=>{const [d,m,y]=s.split('.');return `${y}-${m}-${d}`;};
    const text=rows.flat().join(' '),match=/(\d{2}\.\d{2}\.\d{4})\s*[-–—]\s*(\d{2}\.\d{2}\.\d{4})/.exec(text);
    const from=match?parse(match[1]):dates[0],to=match?parse(match[2]):dates.at(-1);
    if(!from||!to||from>to||dates.some(d=>d<from||d>to))throw Error('Даты начислений Ozon не совпадают с периодом отчёта');
    return {from:from>first?from:first,to:to<last?to:last,declared:!!match};
  }
  window.WBOzonModel={create,add,finish,coverage};
})();
