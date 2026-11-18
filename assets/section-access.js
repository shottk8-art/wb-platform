// Only the signed-in account's server-confirmed section map is cached here.
(function(root){
 'use strict';
 const keys=['overview','daily','stocks','reports','costs','team','settings','account','ai','promocodes'];
 function create({read,onChange=()=>{}}){
  let userId=null,value=null,revision=0,pending=null;
  function clear(id=null){userId=id;value=null;pending=null;++revision;onChange(null);}
  async function load(session,force=false){
   const id=session?.user?.id||null;if(id!==userId)clear(id);
   if(!id)return null;if(pending)return pending;if(value&&!force)return value;
   const ticket=revision;
   pending=Promise.resolve().then(()=>read()).then(result=>{
    if(ticket!==revision||id!==userId)return null;
    if(result?.user_id!==id||!result.sections||keys.some(k=>typeof result.sections[k]!=='boolean'))throw Error('Не удалось проверить доступ к разделам');
    const next={user_id:id,is_admin:result.is_admin===true,sections:Object.fromEntries(keys.map(k=>[k,result.sections[k]]))};
    const changed=JSON.stringify(value)!==JSON.stringify(next);value=next;if(changed)onChange(value);return value;
   }).catch(error=>{if(ticket===revision){value=null;onChange(null);}throw error;}).finally(()=>{if(ticket===revision)pending=null;});
   return pending;
  }
  return {load,clear,current:()=>value,userId:()=>userId,allowed:(id,key)=>!!id&&value?.user_id===id&&value.sections[key]===true};
 }
 if(typeof module==='object'&&module.exports)module.exports={keys,create};
 if(!root.document)return;
 const controller=create({read:async()=>{const {data,error}=await root.supabaseClient.rpc('my_section_access');if(error)throw error;return data;},onChange:()=>root.document.dispatchEvent(new CustomEvent('wb:section-access'))});
 root.WBAccess=controller;
 let session=null,timer=null;
 function schedule(){clearTimeout(timer);if(session&&!root.document.hidden)timer=setTimeout(refresh,60000);}
 async function refresh(){if(!session)return;try{await controller.load(session,true);}catch{/* Fail closed; the page offers retry. */}finally{schedule();}}
 root.supabaseClient.auth.onAuthStateChange((event,next)=>{
  if(session?.user?.id!==next?.user?.id){if(controller.userId()!==(next?.user?.id||null))controller.clear(next?.user?.id||null);clearTimeout(timer);}
  if(session?.user?.id&&next?.user?.id&&session.user.id!==next.user.id)root.location.reload();
  session=next||null;
  if(!session)return;
  schedule();
 });
 root.document.addEventListener('visibilitychange',()=>{if(!root.document.hidden)refresh();else clearTimeout(timer);});
})(typeof window==='undefined'?globalThis:window);
