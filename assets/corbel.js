// Appearance is local only. No API keys, account mutations or financial reads.
(function(){
  const root=document.documentElement, key='seller-appearance';
  let theme='light';
  try{const saved=localStorage.getItem(key);if(saved==='dark'||saved==='light')theme=saved}catch(_){/* storage optional */}
  root.dataset.theme=theme;
  let requestedTheme=theme,themeVersion=0;
  function applyTheme(next){
    if(!['light','dark'].includes(next))return;
    ++themeVersion;requestedTheme=next;
    theme=next;root.dataset.theme=theme;
    try{localStorage.setItem(key,theme)}catch(_){/* private mode */}
    syncTheme();
    window.dispatchEvent(new CustomEvent('seller:themechange',{detail:{theme}}));
  }
  function syncTheme(){
    document.querySelectorAll('[data-theme-toggle]').forEach(button=>{
      button.setAttribute('aria-label',theme==='dark'?'Включить светлую тему':'Включить тёмную тему');
      button.title=button.getAttribute('aria-label');button.setAttribute('aria-pressed',String(theme==='dark'));
      button.querySelector('[data-moon]')?.toggleAttribute('hidden',theme==='dark');
      button.querySelector('[data-sun]')?.toggleAttribute('hidden',theme!=='dark');
    });
    document.querySelectorAll('[data-theme-choice]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.themeChoice===theme)));
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#0f1430':'#dfe4f4');
  }
  function setProfile(user,owner){
    const meta=user?.user_metadata || {},name=String(meta.full_name || meta.telegram_username || 'Пользователь');
    const initials=name.split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('').toUpperCase();
    const username=String(meta.telegram_username || '').replace(/^@/,'');
    document.querySelectorAll('[data-profile-avatar]').forEach(el=>el.textContent=initials);
    document.querySelectorAll('[data-profile-name]').forEach(el=>el.textContent=name);
    const fields={profileName:name,profileTelegram:username?'@'+username:'Ник не указан',profileRole:owner?'Владелец магазина':'Участник магазина'};
    Object.entries(fields).forEach(([id,value])=>{const input=document.getElementById(id);if(input)input.value=value});
    const link=document.getElementById('profileTelegramLink');
    if(link){link.hidden=!/^[a-zA-Z0-9_]{5,32}$/.test(username);if(!link.hidden)link.href='https://t.me/'+encodeURIComponent(username)}
  }
  function wire(){
    const choose=(next,button)=>{
      if(next===requestedTheme)return;
      requestedTheme=next;
      const version=++themeVersion;
      const commit=()=>{if(version===themeVersion)applyTheme(next)};
      if(window.WBShell.motion)window.WBShell.motion.theme(next,button,commit);else commit();
    };
    document.querySelectorAll('[data-theme-toggle]').forEach(button=>button.addEventListener('click',()=>choose(requestedTheme==='dark'?'light':'dark',button)));
    document.querySelectorAll('[data-theme-choice]').forEach(button=>button.addEventListener('click',()=>choose(button.dataset.themeChoice,button)));
    syncTheme();
  }
  window.WBShell={setProfile,applyTheme,chartStyle:'line'};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire,{once:true});else wire();
})();
