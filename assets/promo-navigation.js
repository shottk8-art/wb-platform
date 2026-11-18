// This shortcut belongs to the account's explicit TOPLASH grant, not the selected shop.
(function(root){
  'use strict';
  const shopId='853b81a0-e0e2-4195-bc80-1cdc362af946';
  function create({link,config,fetcher=root.fetch.bind(root)}){
    let session=null,generation=0,pending=null,controller=null,checked=false,sectionAccess;
    link.hidden=true;
    function reset(){++generation;controller?.abort();controller=null;pending=null;checked=false;link.hidden=true;}
    function refresh(){
      if(sectionAccess!==undefined&&(!sectionAccess?.allowed||sectionAccess.userId!==session?.user?.id)){link.hidden=true;return Promise.resolve(false);}
      if(pending)return pending;
      if(!session?.user?.id||!session.access_token){link.hidden=true;return Promise.resolve(false);}
      const ticket=++generation,userId=session.user.id,token=session.access_token;
      const requestController=new AbortController();controller=requestController;link.hidden=true;
      const timer=setTimeout(()=>requestController.abort(),10000);
      pending=Promise.resolve().then(async()=>{
        try{
          const response=await fetcher(config.SUPABASE_URL+'/functions/v1/wb-api',{
            method:'POST',cache:'no-store',signal:requestController.signal,
            headers:{Authorization:'Bearer '+token,apikey:config.SUPABASE_ANON_KEY,'Content-Type':'application/json'},
            body:JSON.stringify({action:'promocodes_access',shop_id:shopId}),
          });
          const value=response.ok?await response.json():null;
          if(ticket!==generation||session?.user?.id!==userId)return false;
          checked=response.ok||response.status===401||response.status===403;
          link.hidden=!(response.ok&&value?.allowed===true&&value.shop_id===shopId);
          return !link.hidden;
        }catch{return false;}
        finally{clearTimeout(timer);if(ticket===generation){pending=null;controller=null;}}
      });
      return pending;
    }
    function setSession(next){
      const same=session?.user?.id===next?.user?.id&&session?.access_token===next?.access_token;
      session=next||null;
      if(same&&(pending||checked))return pending||Promise.resolve(!link.hidden);
      reset();return refresh();
    }
    function setAccess(value){
      sectionAccess=value?{userId:value.user_id,allowed:value.sections?.promocodes===true}:null;
      reset();return refresh();
    }
    return {setSession,refresh,setAccess};
  }
  if(typeof module==='object'&&module.exports)module.exports={create};
  if(!root.document)return;
  root.WBPromoNavigation={create};
  const link=root.document.getElementById('promocodesLink');
  if(!link||!root.WBAuth||!root.supabaseClient?.auth)return;
  const navigation=create({link,config:root.WB_CONFIG});let sessionChanged=false;
  if(root.WBAccess)navigation.setAccess(root.WBAccess.current());
  root.document.addEventListener('wb:section-access',()=>navigation.setAccess(root.WBAccess?.current()||null));
  root.supabaseClient.auth.onAuthStateChange((event,session)=>{
    if(event!=='INITIAL_SESSION')sessionChanged=true;
    navigation.setSession(session);
  });
  root.WBAuth.waitForSession().then(session=>{if(!sessionChanged)navigation.setSession(session);}).catch(()=>{if(!sessionChanged)navigation.setSession(null);});
  root.document.addEventListener('visibilitychange',()=>{if(!root.document.hidden)navigation.refresh();});
  root.document.addEventListener('click',event=>{if(event.target.closest?.('#signOutBtn')){sessionChanged=true;navigation.setSession(null);}},true);
})(typeof window==='undefined'?globalThis:window);
