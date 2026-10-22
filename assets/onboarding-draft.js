// A per-tab UI draft, never authentication, payment or access-control state.
(function(root){
  'use strict';
  const KEY='wb-onboarding-draft:v1',TTL=12*60*60*1000;
  function create(storage,now=()=>Date.now()){
    let memory=null,persistent=!!storage;
    const valid=value=>{
      if(!value||value.version!==1
        ||typeof value.name!=='string'||!value.name.trim()||value.name.length>80
        ||!([null,'start','team'].includes(value.planId))
        ||!Number.isFinite(value.at)||value.at>now()||now()-value.at>TTL
        ||!(value.userId===null||(typeof value.userId==='string'
          &&value.userId.length>0&&value.userId.length<=128)))return null;
      return {
        version:1,name:value.name.trim(),
        planId:value.planId,at:value.at,userId:value.userId
      };
    };
    function readRaw(){
      if(!persistent)return valid(memory);
      try{memory=valid(JSON.parse(storage.getItem(KEY)||'null'));}
      catch{persistent=false;}
      return valid(memory);
    }
    function write(value){
      memory=value;
      try{storage.setItem(KEY,JSON.stringify(value));}catch{persistent=false;}
      return true;
    }
    return {
      get persistent(){return persistent;},
      read(userId=null){
        const value=readRaw();
        return value&&value.userId===userId?{...value}:null;
      },
      save({name,planId=null}){
        const value=valid({version:1,name,planId,at:now(),userId:null});
        return value?write(value):false;
      },
      // Called only with the session returned by the existing Telegram login.
      bind(userId){
        const value=readRaw();
        if(!value||!userId||(value.userId&&value.userId!==userId))return false;
        const next=valid({...value,userId});
        return next?write(next):false;
      },
      clear(userId=null){
        const value=readRaw();if(!value||value.userId!==userId)return;
        memory=null;
        try{storage.removeItem(KEY);}catch{persistent=false;}
      },
    };
  }
  const api={create,KEY,TTL};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else{
    let storage;try{storage=root.sessionStorage;}catch{storage=null;}
    root.WBOnboardingDraft=create(storage);
  }
})(typeof window==='object'?window:globalThis);
