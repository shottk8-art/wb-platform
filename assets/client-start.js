(function () {
  'use strict';
  const $=(id)=>document.getElementById(id);
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rub=n=>new Intl.NumberFormat('ru-RU').format(n)+' ₽';
  const date=s=>new Date(s).toLocaleDateString('ru-RU');
  let store,user;
  function start(u) {if(user===u.id)return;user=u.id;let storage;try{storage=window.localStorage;}catch{storage=null;}store=WBTestSubscription.create(user,storage);}
  const checkIcon='<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29"/><path d="m19 32 9 9 18-19"/></svg>';
  const arrowIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>';
  const planArt=plan=>`<svg class="client-plan-art" viewBox="0 0 72 48" aria-hidden="true">${[0,1,2,3,4,5].slice(0,plan.shops).map(i=>`<rect x="${4+(i%3)*22}" y="${plan.shops===2?13:3+Math.floor(i/3)*23}" width="18" height="18" rx="5"/>`).join('')}</svg>`;
  function enter(node,direction=1) {
    if(!node||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    node.animate?.([{opacity:.4,transform:`translateX(${direction*12}px)`,clipPath:'inset(0 0 0 2%)'},{opacity:1,transform:'translateX(0)',clipPath:'inset(0)'}],{duration:240,easing:'cubic-bezier(.16,1,.3,1)'});
  }
  function billing(root,{onContinue,onScreenChange}={}) {
    if(!root)return;
    let chosen=null,attemptId=null;
    const focus=()=>{root.querySelector('[data-billing-title]')?.focus({preventScroll:true});};
    const privacy=()=>store.persistent?'':'<p class="client-storage-note" role="status">Браузер не сохраняет выбранный тариф. После закрытия страницы его нужно будет выбрать снова.</p>';
    function choose(id){chosen=WBTestSubscription.PLANS.find(p=>p.id===id);attemptId=store.begin(id).id;paint('checkout');focus();}
    function paint(screen='plans',outcome=null) {
      const state=store.state,s=state.subscription,p=WBTestSubscription.PLANS.find(p=>p.id===s?.plan);
      if(screen==='checkout') {
        root.innerHTML=`<section class="client-billing client-checkout" aria-label="Подтверждение тестовой оплаты"><button class="client-back" type="button" data-result="cancelled">Назад к тарифам</button><div class="client-section-head"><h2 tabindex="-1" data-billing-title>Подтвердите тариф</h2><span class="client-test-badge">Тестовая оплата</span></div><div class="client-order"><span>«${chosen.name}» на месяц</span><strong>${rub(chosen.price)}</strong><span>Магазины</span><span>до ${chosen.shops}</span><span>Сотрудники</span><span>до ${chosen.employees}</span><span>К оплате сейчас</span><strong>0 ₽</strong></div><p class="client-safe-note">Карта не нужна. Деньги не спишутся.</p><div class="client-checkout-actions"><button type="button" class="primary" data-result="success">Подтвердить (тест) ${arrowIcon}</button><details class="client-test-details"><summary>Проверить отказ оплаты</summary><button type="button" class="client-text-button" data-result="declined">Показать отказ</button></details></div>${privacy()}</section>`;
        let busy=false;const checkout=root.querySelector('.client-checkout');
        checkout.querySelectorAll('[data-result]').forEach(button=>button.onclick=async()=>{
          if(busy)return;busy=true;const status=button.dataset.result;
          // Finish this exact attempt before animation or a shop transition.
          if(!store.finish(status,attemptId)){paint();focus();return;}
          if(status==='cancelled'){paint();root.querySelector(`[data-test-plan="${chosen.id}"]`)?.focus();return;}
          onScreenChange?.('processing',status);
          checkout.setAttribute('aria-busy','true');checkout.querySelectorAll('button').forEach(b=>b.disabled=true);button.textContent='Подтверждаем…';
          await new Promise(resolve=>setTimeout(resolve,350));
          if(!root.isConnected||!checkout.isConnected||root.closest('[hidden]'))return;
          paint('result',status);focus();
        });
      } else if(screen==='result') {
        const success=outcome==='success';
        root.innerHTML=`<section class="client-billing client-result ${success?'is-success':'is-declined'}" aria-label="Результат тестовой оплаты"><div class="client-result-mark">${success?checkIcon:'<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29"/><path d="M32 19v17m0 9h.01"/></svg>'}</div><h2 tabindex="-1" data-billing-title>${success?'Тариф выбран':'Оплата не прошла'}</h2><p class="client-payment-status" role="status">${success?'Тестовая оплата прошла. Деньги не списаны.':'Это тестовый отказ. Деньги не списаны.'}</p><div class="client-result-summary"><span>Тариф «${chosen.name}»</span><strong>${rub(chosen.price)} / месяц</strong><span>До ${chosen.shops} магазинов · до ${chosen.employees} сотрудников</span></div><button type="button" class="primary" data-payment-next>${success?(onContinue?'К созданию магазина':'К тарифам'):'Попробовать снова'} ${arrowIcon}</button>${!success?'<button class="client-text-button" type="button" data-payment-plans>Выбрать другой тариф</button>':''}${privacy()}</section>`;
        root.querySelector('[data-payment-next]').onclick=()=>{if(!success)choose(chosen.id);else if(onContinue)onContinue();else {paint();focus();}};
        root.querySelector('[data-payment-plans]')?.addEventListener('click',()=>{paint();root.querySelector(`[data-test-plan="${chosen.id}"]`)?.focus({preventScroll:true});});
      } else {
        root.innerHTML=`<section class="client-billing" aria-label="Тестовая подписка"><div class="client-section-head"><div><h2 tabindex="-1" data-billing-title>${onContinue?'Выберите тариф':'Тариф и подписка'}</h2></div><span class="client-test-badge">Тестовая оплата</span></div><div class="client-plans">${WBTestSubscription.PLANS.map(plan=>`<article class="client-plan ${p?.id===plan.id&&s.status==='active'?'is-current':''}" data-plan="${plan.id}">${planArt(plan)}<div class="client-plan-heading"><h3>${plan.name}</h3>${p?.id===plan.id&&s.status==='active'?'<span class="client-plan-current">Выбран · тест</span>':''}</div><p class="client-price">${rub(plan.price)}<span> / месяц</span></p><ul><li>${checkIcon}<span>До ${plan.shops} магазинов</span></li><li>${checkIcon}<span>До ${plan.employees} сотрудников</span></li></ul><button type="button" class="${plan.id==='start'?'primary':'ghost'}" data-test-plan="${plan.id}">Выбрать тариф ${arrowIcon}</button></article>`).join('')}</div><p class="client-count-note">Wildberries и Ozon считаются двумя магазинами.</p>${!onContinue&&s?`<div class="client-payment-status" role="status"><strong>${s.status==='active'?'Тестовая подписка активна':'Тестовая подписка отменена'}</strong><p>«${p.name}»${s.status==='active'?` · до ${date(s.until)}`:''}</p></div>`:''}${!onContinue&&s?.status==='active'?'<button type="button" class="client-text-button" data-cancel-sub>Отменить тестовую подписку</button>':''}<details class="client-test-details"><summary>О тестовой оплате</summary><p>Деньги не списываются. Выбор тарифа сохраняется только в этом браузере. Лимиты магазинов и сотрудников пока не применяются.</p></details>${!onContinue&&state.history.length?`<details class="client-history"><summary>История тестовых оплат (${state.history.length})</summary><ul>${state.history.map(h=>`<li><span>${date(h.at)} · ${esc(WBTestSubscription.PLANS.find(p=>p.id===h.plan).name)}</span><strong>${({success:'Успешно',declined:'Отказ',cancelled:'Отменено'})[h.status]}</strong></li>`).join('')}</ul></details>`:''}${privacy()}</section>`;
        root.querySelectorAll('[data-test-plan]').forEach(button=>button.onclick=()=>choose(button.dataset.testPlan));
        root.querySelector('[data-cancel-sub]')?.addEventListener('click',()=>{store.cancel();paint();focus();});
      }
      onScreenChange?.(screen,outcome);
      enter(root.firstElementChild);
    }
    paint();
  }
  function firstShop(u,{createShop,signOut}) {
    start(u);const root=$('clientWelcome');
    $('loadingScreen').hidden=true;root.hidden=false;
    root.innerHTML=`
      <header class="client-welcome-top">
        <a class="client-brand" href="/index.html"><img src="/assets/icons/icon.svg" width="34" height="34" alt=""><span>Панель продавца</span></a>
        <nav aria-label="Действия при первом входе"><button class="client-theme" type="button" data-client-theme aria-label="Переключить цветовую тему"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"/></svg></button><a href="/demo.html"><span class="client-demo-full">Посмотреть </span>демо</a><button type="button" class="client-text-button" data-welcome-exit>Выйти</button></nav>
      </header>
      <div class="client-onboarding-shell">
        <aside class="client-story">
          <h1>Аналитика<br><span>вашего магазина.</span></h1>
          <p>Продажи, расходы и прибыль Wildberries и Ozon в одном кабинете.</p>
          <figure class="client-story-art"><img src="/assets/illustrations/seller-economics-480.webp" srcset="/assets/illustrations/seller-economics-480.webp 480w, /assets/illustrations/seller-economics-960.webp 960w" sizes="(max-width:900px) 128px, 360px" width="960" height="960" alt="" decoding="async"></figure>
        </aside>
        <div class="client-onboarding-work">
          <nav class="client-step-nav" aria-label="Этапы настройки"><ol><li data-step-indicator="0" aria-current="step"><span>1</span>Магазин</li><li data-step-indicator="1"><span>2</span>Тариф</li><li data-step-indicator="2"><span>3</span>Проверка</li></ol><div class="client-step-progress"><i></i></div></nav>
          <div class="client-stage-surface">
            <section class="client-stage" data-client-step="0"><form class="client-setup"><h2 tabindex="-1">Добавьте магазин</h2><p>Укажите название и выберите маркетплейс.</p><label for="welcomeShopName">Название магазина</label><input id="welcomeShopName" name="shopName" required maxlength="80" autocomplete="organization" placeholder="Например, Мой бренд"><fieldset><legend>Маркетплейс</legend><label class="client-market-option" data-market="wildberries"><input type="radio" name="marketplace" value="wildberries" checked><span class="client-market-mark">WB</span><span><strong>Wildberries</strong><small>Подключение по API-ключу</small></span><i aria-hidden="true"></i></label><label class="client-market-option" data-market="ozon"><input type="radio" name="marketplace" value="ozon"><span class="client-market-mark">O</span><span><strong>Ozon</strong><small>Загрузка файла с отчётом</small></span><i aria-hidden="true"></i></label></fieldset><button class="primary" type="submit">Выбрать тариф ${arrowIcon}</button><p class="client-count-note">Второй маркетплейс можно добавить позже.</p></form></section>
            <section class="client-stage" data-client-step="1" hidden><div class="client-stage-tools"><button class="client-back" type="button" data-step-back="0">Назад к магазину</button><button class="client-skip" type="button" data-skip-payment>Продолжить без оплаты ${arrowIcon}</button></div><div id="welcomeBilling"></div></section>
            <section class="client-stage client-ready" data-client-step="2" hidden><div class="client-result-mark">${checkIcon}</div><h2 tabindex="-1">Проверьте данные</h2><p data-ready-next></p><dl class="client-ready-summary"><div><dt>Магазин</dt><dd data-ready-name></dd></div><div><dt>Маркетплейс</dt><dd data-ready-market></dd></div><div><dt>Тариф</dt><dd data-ready-plan></dd></div></dl><button class="primary" type="button" data-create-shop>Создать магазин ${arrowIcon}</button><button class="client-text-button" type="button" data-step-back="0">Изменить данные</button><p class="client-form-status" role="status" aria-live="polite"></p></section>
          </div>
        </div>
      </div>`;
    root.querySelector('[data-welcome-exit]').onclick=signOut;
    root.querySelector('[data-client-theme]').onclick=()=>window.WBShell?.applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');
    return new Promise(resolve=>{
      const form=root.querySelector('form');let busy=false,step=0;
      function go(next){
        const previous=step;step=next;
        root.querySelectorAll('[data-client-step]').forEach(panel=>panel.hidden=Number(panel.dataset.clientStep)!==step);
        root.querySelectorAll('[data-step-indicator]').forEach(item=>{const index=Number(item.dataset.stepIndicator);item.classList.toggle('is-complete',index<step);if(index===step)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');});
        root.querySelector('.client-step-progress i').style.transform=`scaleX(${(step+1)/3})`;
        if(step===1)billing($('welcomeBilling'),{onContinue:()=>go(2),onScreenChange:(screen,outcome)=>{
          const skip=root.querySelector('[data-skip-payment]');
          skip.hidden=['processing','result'].includes(screen)&&outcome==='success';
          skip.textContent=store.state.subscription?.status==='active'?'К созданию магазина':'Продолжить без оплаты';
        }});
        if(step===2){
          const s=store.state.subscription,p=WBTestSubscription.PLANS.find(p=>p.id===s?.plan),ozon=form.elements.marketplace.value==='ozon';
          root.querySelector('[data-ready-name]').textContent=form.elements.shopName.value.trim();
          root.querySelector('[data-ready-market]').textContent=ozon?'Ozon':'Wildberries';
          root.querySelector('[data-ready-plan]').textContent=s?.status==='active'?`${p.name} (тест)`:'Не выбран';
          root.querySelector('[data-ready-next]').textContent=ozon?'После создания загрузите отчёт Ozon в разделе «Отчёты».':'После создания подключите API-ключ Wildberries в настройках.';
        }
        const panel=root.querySelector(`[data-client-step="${step}"]`);if(step!==1)enter(panel,step>=previous?1:-1);panel.querySelector('h2')?.focus({preventScroll:true});
      }
      form.onsubmit=e=>{e.preventDefault();if(busy)return;
        const name=form.elements.shopName.value.trim();if(!name){form.elements.shopName.setCustomValidity('Введите название магазина');form.elements.shopName.reportValidity();return;}
        go(1);
      };
      root.querySelector('[data-skip-payment]').onclick=()=>{store.finish('cancelled');go(2);};
      root.querySelectorAll('[data-step-back]').forEach(button=>button.onclick=()=>{if(!busy){store.finish('cancelled');go(Number(button.dataset.stepBack));}});
      root.querySelector('[data-create-shop]').onclick=async()=>{
        if(busy)return;busy=true;
        const submit=root.querySelector('[data-create-shop]'),status=root.querySelector('.client-form-status');submit.disabled=true;submit.textContent='Создаём магазин…';root.querySelectorAll('[data-step-back]').forEach(b=>b.disabled=true);status.textContent='';
        const name=form.elements.shopName.value.trim();
        const marketplace=form.elements.marketplace.value;
        try {const shop=await createShop(name,marketplace);if(!shop?.id)throw new Error('Магазин не был создан');store.finish('cancelled');store.guide(false);root.hidden=true;$('loadingScreen').hidden=false;resolve({shop,marketplace});}
        catch(error){status.textContent='Не удалось создать магазин. Проверьте соединение и попробуйте снова.';submit.disabled=false;submit.textContent='Создать магазин';root.querySelectorAll('[data-step-back]').forEach(b=>b.disabled=false);busy=false;}
      };
      form.elements.shopName.oninput=()=>form.elements.shopName.setCustomValidity('');
    });
  }
  function mount(u,{navigate}) {
    start(u);billing($('testBillingRoot'));
    const guide=$('clientGuide');
    const paint=()=>{guide.hidden=store.state.guideHidden;};
    guide.innerHTML=`<div class="client-section-head"><div><h2>Начало работы</h2></div><button class="ghost small" type="button" data-guide-hide>Скрыть</button></div><ol class="client-guide-steps"><li><button type="button" data-guide-view="settings">Загрузите данные</button><span>Wildberries — API-ключ в настройках. Ozon — файл в «Отчётах».</span><a href="#reports" data-guide-view="reports">Загрузить отчёт Ozon</a></li><li><button type="button" data-guide-view="costs">Добавьте себестоимость</button><span>Себестоимость общая для WB и Ozon. Ставка налога — в настройках.</span></li><li><button type="button" data-guide-view="overview">Откройте обзор</button><span>После загрузки данных выберите маркетплейс и месяц.</span></li></ol><div class="client-guide-footer"><a href="/demo.html" target="_blank" rel="noopener">Открыть демо</a><button class="ghost small" type="button" data-guide-view="account">Тарифы</button></div>`;
    guide.querySelector('[data-guide-hide]').onclick=()=>{store.guide(true);paint();$('showClientGuide').focus();};
    guide.querySelector('[data-guide-view="reports"]').dataset.guideMarketplace='ozon';
    guide.querySelectorAll('[data-guide-view]').forEach(button=>button.onclick=e=>{e.preventDefault();navigate(button.dataset.guideView,button.dataset.guideMarketplace);});
    $('showClientGuide').onclick=()=>{store.guide(false);paint();navigate('overview');guide.scrollIntoView({block:'start'});};paint();
  }
  window.WBClientStart={firstShop,mount};
})();
