/* Browser-only product prototype. Never an authorization or quota source. */
(function (root) {
  'use strict';
  const PLANS = Object.freeze([
    Object.freeze({id:'start',name:'Старт',price:1990,shops:2,employees:2}),
    Object.freeze({id:'team',name:'Команда',price:2990,shops:6,employees:6}),
  ]);
  function nextMonth(iso) {
    const d=new Date(iso), day=d.getUTCDate();
    d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1);
    const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
    d.setUTCDate(Math.min(day,last));return d.toISOString();
  }
  function create(userId,storage,now=()=>new Date().toISOString()) {
    if(!userId)throw new Error('Для тестовой подписки нужна учётная запись');
    const key='wb-test-subscription:v1:'+userId;
    let state={version:1,mode:'simulation',subscription:null,history:[],guideHidden:true},pending=null,persistent=true,sequence=0;
    try {
      const raw=JSON.parse(storage.getItem(key)||'null');
      if(raw?.version===1 && raw.mode==='simulation') {
        const valid=x=>x && PLANS.some(p=>p.id===x.plan) && Number.isFinite(Date.parse(x.at));
        state.history=Array.isArray(raw.history)?raw.history.filter(x=>valid(x)&&['success','declined','cancelled'].includes(x.status)).slice(0,12):[];
        const s=raw.subscription;
        if(valid(s)&&Number.isFinite(Date.parse(s.until))&&['active','cancelled'].includes(s.status)) state.subscription={plan:s.plan,at:s.at,until:s.until,status:s.status};
        state.guideHidden=raw.guideHidden===true;
      }
    } catch {persistent=false;}
    const save=()=>{try{storage.setItem(key,JSON.stringify(state));}catch{persistent=false;}};
    return {
      get state(){return JSON.parse(JSON.stringify(state));},get persistent(){return persistent;},
      begin(plan){if(!PLANS.some(p=>p.id===plan))throw new Error('Выберите тариф');if(pending)return {...pending};pending={id:String(++sequence),plan,at:now()};return {...pending};},
      finish(status,attemptId){if(!pending||(attemptId!=null&&pending.id!==attemptId)||!['success','declined','cancelled'].includes(status))return false;
        const attempt={...pending,status};pending=null;state.history.unshift(attempt);state.history=state.history.slice(0,12);
        if(status==='success')state.subscription={plan:attempt.plan,at:attempt.at,until:nextMonth(attempt.at),status:'active'};
        save();return true;
      },
      cancel(){if(state.subscription){state.subscription.status='cancelled';save();}},
      guide(hidden){state.guideHidden=!!hidden;save();},
    };
  }
  const api={PLANS,create,nextMonth};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.WBTestSubscription=api;
})(typeof window==='object'?window:globalThis);
