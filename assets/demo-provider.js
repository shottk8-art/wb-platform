/* Local adapter for the real daily/unit/inventory UI; never calls a service. */
(function(){
  'use strict';
  const sample=window.WBDemoModel.create(),shopId='00000000-0000-4000-8000-000000000001',userId='demo-visitor';
  const listeners=new Set();
  window.WBDemo={sample,shopId,userId,notify:()=>listeners.forEach(fn=>fn())};
  // This demo document does not load authentication or the production adapter.
  window.WBAccess={allowed:(user,section)=>user===userId&&['daily','stocks'].includes(section)};
  window.WBApi={shopId,connected:true,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
    async cabinet(action,month,_refresh,body={}){
      const marketplace=body.marketplace||'wildberries';let result;
      if(action==='daily')result=sample.daily(month,marketplace);
      else if(action==='unit')result=sample.unit(body.from||month+'-01',body.to||sample.end(body.month_to||month),marketplace);
      else if(action==='ozon_months')result={months:sample.available('ozon').map(sample.key).reverse(),periods:sample.available('ozon').map(p=>({month:sample.key(p),dateFrom:sample.key(p)+'-01',dateTo:sample.end(sample.key(p))}))};
      else if(action==='daily_start')result={background:false};
      else if(action==='stocks'||action==='stocks_refresh')result=sample.stocks();
      else if(action==='stocks_tracking'){
        const index=Number(body.nm_id)-90000001,p=sample.catalogue[index];if(!p)throw Error('Товар не найден');
        if(body.excluded)sample.state.excluded.add(p.article);else sample.state.excluded.delete(p.article);result=sample.stocks();
      }else if(action==='stocks_settings'){
        if(!Number.isInteger(body.alert_days)||!Number.isInteger(body.target_days)||body.alert_days<1||body.alert_days>180||body.target_days<body.alert_days||body.target_days>365)throw Error('Проверьте сроки пополнения');
        sample.state.alertDays=body.alert_days;sample.state.targetDays=body.target_days;result=sample.stocks();
      }else throw Error('Это действие доступно в своём кабинете');
      return new Promise(resolve=>setTimeout(()=>resolve(structuredClone(result)),100));
    }};
})();
