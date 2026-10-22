// Name editing is presentation only; the existing owner RLS is authoritative.
(function(root){
  'use strict';
  function create({form,input,button,status,hint,rename,onSaved}){
    let context=null;
    const pending=new Map();
    const key=c=>c?`${c.userId}:${c.id}`:null;
    const owns=()=>!!(context&&context.userId===context.owner_id);
    const valid=()=>!!input.value.trim()&&input.value.trim().length<=80;
    function render(){
      const busy=!!pending.get(key(context));
      input.disabled=!context||busy;input.readOnly=!owns();
      button.hidden=!!context&&!owns();
      button.disabled=!owns()||busy||!valid()||input.value.trim()===context?.name;
      button.textContent=busy?'Сохраняем…':'Сохранить';
      form.setAttribute('aria-busy',String(busy));
      hint.textContent=context&&!owns()?'Изменить название может только владелец магазина.':'Название в меню и на витрине. Отчёты и адрес ссылки сохранятся.';
    }
    function setContext(next){
      const c=next?.shop?{id:next.shop.id,owner_id:next.shop.owner_id,name:next.shop.name,userId:next.userId}:null;
      const same=key(c)===key(context)&&c?.owner_id===context?.owner_id&&c?.name===context?.name;
      context=c;
      if(!same){input.value=c?(pending.get(key(c))?.name||c.name):'';status.textContent='';status.dataset.tone='neutral';}
      render();
    }
    input.addEventListener('input',()=>{status.textContent='';status.dataset.tone='neutral';render();});
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(!owns()||!valid()||pending.has(key(context))||input.value.trim()===context.name)return;
      const target={...context},name=input.value.trim(),requestKey=key(target);
      pending.set(requestKey,{name});status.textContent='';render();
      let saved;
      try{
        saved=await rename(target.id,name);
        if(saved?.id!==target.id||typeof saved.name!=='string')throw Error('Missing updated shop');
      }catch{
        pending.delete(requestKey);
        if(key(context)===requestKey){status.textContent='Не удалось сохранить название. Проверьте соединение и права доступа, затем повторите.';status.dataset.tone='error';}
        render();return;
      }
      pending.delete(requestKey);
      if(key(context)===requestKey&&owns()){
        context={...context,name:saved.name};input.value=saved.name;
        status.textContent='Название сохранено';status.dataset.tone='success';
      }
      // A display failure must not turn a confirmed name update into a failed save.
      try{onSaved(saved,target.userId);}catch{}
      render();
    });
    render();
    return{setContext};
  }
  let editor=null;
  const api={create,mount:options=>{editor=create(options);},setContext:next=>editor?.setContext(next)};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.WBShopName=api;
})(typeof window==='object'?window:globalThis);
