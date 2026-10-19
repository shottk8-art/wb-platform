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
  function enter(node,direction=1) {
    if(!node||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    node.animate?.([{opacity:.4,transform:`translateX(${direction*12}px)`,clipPath:'inset(0 0 0 2%)'},{opacity:1,transform:'translateX(0)',clipPath:'inset(0)'}],{duration:240,easing:'cubic-bezier(.16,1,.3,1)'});
  }
  function billing(root,{onContinue,onScreenChange}={}) {
    if(!root)return;
    let chosen=null,attemptId=null;
    const focus=()=>{root.querySelector('[data-billing-title]')?.focus({preventScroll:true});};
    const privacy=()=>`<p class="client-storage-note">${store.persistent?'Тестовая подписка хранится только в этом браузере. Доступ к магазину не меняется.':'Хранилище браузера недоступно: результат теста не сохранится после закрытия страницы.'}</p>`;
    function choose(id){chosen=WBTestSubscription.PLANS.find(p=>p.id===id);attemptId=store.begin(id).id;paint('checkout');focus();}
    function paint(screen='plans',outcome=null) {
      const state=store.state,s=state.subscription,p=WBTestSubscription.PLANS.find(p=>p.id===s?.plan);
      if(screen==='checkout') {
        root.innerHTML=`<section class="client-billing client-checkout" aria-label="Подтверждение тестовой оплаты"><button class="client-back" type="button" data-result="cancelled">Назад к тарифам</button><div class="client-section-head"><h2 tabindex="-1" data-billing-title>Всё готово к тесту</h2><span class="client-test-badge">Тестовый режим</span></div><p>Вы выбрали тариф «${chosen.name}». Проверим, как проходит оплата.</p><div class="client-order"><span>Подписка на месяц</span><strong>${rub(chosen.price)}</strong><span>Магазины</span><span>до ${chosen.shops}</span><span>Сотрудники</span><span>до ${chosen.employees}</span><span>Списание сейчас</span><strong>0 ₽ · тест</strong></div><p class="client-safe-note">Без карты, перевода денег и автоплатежей.</p><div class="client-checkout-actions"><button type="button" class="primary" data-result="success">Провести тестовую оплату ${arrowIcon}</button><button type="button" class="client-text-button" data-result="declined">Смоделировать отказ</button></div>${privacy()}</section>`;
        let busy=false;const checkout=root.querySelector('.client-checkout');
        checkout.querySelectorAll('[data-result]').forEach(button=>button.onclick=async()=>{
          if(busy)return;busy=true;const status=button.dataset.result;
          // Finish this exact attempt before animation or a shop transition.
          if(!store.finish(status,attemptId)){paint();focus();return;}
          if(status==='cancelled'){paint();root.querySelector(`[data-test-plan="${chosen.id}"]`)?.focus();return;}
          onScreenChange?.('processing',status);
          checkout.setAttribute('aria-busy','true');checkout.querySelectorAll('button').forEach(b=>b.disabled=true);button.textContent='Проверяем тест…';
          await new Promise(resolve=>setTimeout(resolve,350));
          if(!root.isConnected||!checkout.isConnected||root.closest('[hidden]'))return;
          paint('result',status);focus();
        });
      } else if(screen==='result') {
        const success=outcome==='success';
        root.innerHTML=`<section class="client-billing client-result ${success?'is-success':'is-declined'}" aria-label="Результат тестовой оплаты"><div class="client-result-mark">${success?checkIcon:'<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29"/><path d="M32 19v17m0 9h.01"/></svg>'}</div><h2 tabindex="-1" data-billing-title>${success?'Тест прошёл успешно':'Проверили сценарий отказа'}</h2><p class="client-payment-status" role="status">${success?'Тестовая подписка активна. Деньги не списаны.':'Тестовая оплата отклонена. Доступ к магазину не изменился.'}</p><div class="client-result-summary"><span>Тариф «${chosen.name}»</span><strong>${rub(chosen.price)} / месяц</strong><span>До ${chosen.shops} магазинов · до ${chosen.employees} сотрудников</span></div><button type="button" class="primary" data-payment-next>${success?(onContinue?'Продолжить настройку':'Вернуться к подписке'):'Попробовать ещё раз'} ${arrowIcon}</button>${!success?'<button class="client-text-button" type="button" data-payment-plans>Назад к тарифам</button>':''}${privacy()}</section>`;
        root.querySelector('[data-payment-next]').onclick=()=>{if(!success)choose(chosen.id);else if(onContinue)onContinue();else {paint();focus();}};
        root.querySelector('[data-payment-plans]')?.addEventListener('click',()=>{paint();root.querySelector(`[data-test-plan="${chosen.id}"]`)?.focus({preventScroll:true});});
      } else {
        root.innerHTML=`<section class="client-billing" aria-label="Тестовая подписка"><div class="client-section-head"><div><h2 tabindex="-1" data-billing-title>${onContinue?'Выберите свой масштаб':'Тариф и подписка'}</h2><p>${onContinue?'Начните с нужного количества площадок и сотрудников.':'Ваши площадки, команда и тестовая подписка.'}</p></div><span class="client-test-badge">Тестовый режим</span></div><div class="client-plans">${WBTestSubscription.PLANS.map(plan=>`<article class="client-plan ${p?.id===plan.id&&s.status==='active'?'is-current':''}"><div class="client-plan-heading"><h3>${plan.name}</h3>${p?.id===plan.id&&s.status==='active'?'<span class="client-plan-current">Активен · тест</span>':''}</div><p class="client-price">${rub(plan.price)}<span> / месяц</span></p><p class="client-plan-description">${plan.id==='start'?'Для первых площадок':'Для нескольких магазинов'}</p><ul><li>${checkIcon}<span>До ${plan.shops} магазинов</span></li><li>${checkIcon}<span>До ${plan.employees} сотрудников</span></li></ul><button type="button" class="${plan.id==='start'?'primary':'ghost'}" data-test-plan="${plan.id}">${p?.id===plan.id&&s.status==='active'?'Повторить тест':'Выбрать тариф'} ${arrowIcon}</button></article>`).join('')}</div><p class="client-count-note">Wildberries и Ozon считаются двумя магазинами, даже под одним названием. Лимиты в тесте не ограничивают работу.</p><div class="client-payment-status" role="status">${s?`<strong>${s.status==='active'?'Тестовая подписка активна':'Тестовая подписка отменена'}</strong><p>${p.name} · ${rub(p.price)} в месяц${s.status==='active'?` · до ${date(s.until)}`:''}.</p>`:'Оплата пока необязательна: можно начать без неё.'}</div>${s?.status==='active'?'<button type="button" class="client-text-button" data-cancel-sub>Отменить тестовую подписку</button>':''}<details class="client-test-details"><summary>Как работает тестовая оплата?</summary><p>Это симуляция: карта не нужна, деньги не списываются, автоплатежей нет. Выбор хранится только в этом браузере и не меняет ваш доступ к платформе.</p></details>${state.history.length?`<details class="client-history"><summary>История тестов (${state.history.length})</summary><ul>${state.history.map(h=>`<li><span>${date(h.at)} · ${esc(WBTestSubscription.PLANS.find(p=>p.id===h.plan).name)}</span><strong>${({success:'Успешно · тест',declined:'Отклонено · тест',cancelled:'Отменено'})[h.status]}</strong></li>`).join('')}</ul></details>`:''}${privacy()}</section>`;
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
    root.innerHTML=`<header class="client-welcome-top"><a class="client-brand" href="/index.html"><img src="/assets/icons/icon.svg" width="34" height="34" alt=""><span>Панель продавца</span></a><nav aria-label="Действия при первом входе"><button class="client-theme" type="button" data-client-theme aria-label="Переключить цветовую тему"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"/></svg></button><a href="/demo.html"><span class="client-demo-full">Посмотреть </span>демо</a><button type="button" class="client-text-button" data-welcome-exit>Выйти</button></nav></header><div class="client-onboarding-shell"><aside class="client-story"><h1>Вся экономика.<br>Один кабинет.</h1><p>Продажи, расходы и прибыль Wildberries и Ozon — с понятной динамикой и деталями по каждому товару.</p><div class="client-data-flow" aria-label="Как работает расчёт"><div class="client-flow-source"><span>WB</span><span>Ozon</span><p>Данные ваших площадок</p></div><svg class="client-flow-connector" viewBox="0 0 300 56" aria-hidden="true"><path d="M75 0v16q0 12 12 12h126q12 0 12-12V0M150 28v28"/></svg><div class="client-flow-calculation"><span>Себестоимость</span><b>+</b><span>Налог и расходы</span></div><svg class="client-flow-stem" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 0v40m-6-7 6 7 6-7"/></svg><div class="client-flow-result"><span>${checkIcon}</span><div><strong>Реальная картина магазина</strong><p>Без ручного сведения таблиц</p></div></div></div><a class="client-demo-link" href="/demo.html">Сначала посмотреть, как это работает ${arrowIcon}</a></aside><div class="client-onboarding-work"><nav class="client-step-nav" aria-label="Этапы настройки"><ol><li data-step-indicator="0" aria-current="step"><span>1</span>Магазин</li><li data-step-indicator="1"><span>2</span>Тариф</li><li data-step-indicator="2"><span>3</span>Готово</li></ol><div class="client-step-progress"><i></i></div></nav><div class="client-stage-surface"><section class="client-stage" data-client-step="0"><form class="client-setup"><h2 tabindex="-1">Начнём с вашего магазина</h2><p>Название и площадка — всё, что нужно для первого шага.</p><label for="welcomeShopName">Название магазина</label><input id="welcomeShopName" name="shopName" required maxlength="80" autocomplete="organization" placeholder="Например, Мой бренд"><fieldset><legend>С какой площадки начнём?</legend><label class="client-market-option"><input type="radio" name="marketplace" value="wildberries" checked><span class="client-market-mark">WB</span><span><strong>Wildberries</strong><small>Подключение API в настройках</small></span><i aria-hidden="true"></i></label><label class="client-market-option"><input type="radio" name="marketplace" value="ozon"><span class="client-market-mark">O</span><span><strong>Ozon</strong><small>Импорт отчёта по начислениям</small></span><i aria-hidden="true"></i></label></fieldset><button class="primary" type="submit">Продолжить ${arrowIcon}</button><p class="client-count-note">Вторую площадку можно добавить позже. Магазин создадим только после подтверждения.</p></form></section><section class="client-stage" data-client-step="1" hidden><div class="client-stage-tools"><button class="client-back" type="button" data-step-back="0">Назад к магазину</button><button class="client-skip" type="button" data-skip-payment>Пропустить оплату ${arrowIcon}</button></div><div id="welcomeBilling"></div></section><section class="client-stage client-ready" data-client-step="2" hidden><div class="client-result-mark">${checkIcon}</div><h2 tabindex="-1">Ваш кабинет почти готов</h2><p>Проверьте выбор. После создания откроем нужный раздел для загрузки данных.</p><dl class="client-ready-summary"><div><dt>Магазин</dt><dd data-ready-name></dd></div><div><dt>Площадка</dt><dd data-ready-market></dd></div><div><dt>Подписка</dt><dd data-ready-plan></dd></div></dl><button class="primary" type="button" data-create-shop>Создать и открыть кабинет ${arrowIcon}</button><button class="client-text-button" type="button" data-step-back="0">Изменить данные</button><p class="client-form-status" role="status" aria-live="polite"></p></section></div><p class="client-onboarding-note">Никаких списаний. Тестовую оплату можно пропустить.</p></div></div>`;
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
          skip.textContent=store.state.subscription?.status==='active'?'Продолжить настройку':'Пропустить оплату';
        }});
        if(step===2){const s=store.state.subscription,p=WBTestSubscription.PLANS.find(p=>p.id===s?.plan);root.querySelector('[data-ready-name]').textContent=form.elements.shopName.value.trim();root.querySelector('[data-ready-market]').textContent=form.elements.marketplace.value==='ozon'?'Ozon':'Wildberries';root.querySelector('[data-ready-plan]').textContent=s?.status==='active'?`${p.name} · тестовая`:'Без оплаты';}
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
        catch(error){status.textContent='Не удалось создать магазин. Проверьте соединение и попробуйте снова.';submit.disabled=false;submit.textContent='Создать и открыть кабинет';root.querySelectorAll('[data-step-back]').forEach(b=>b.disabled=false);busy=false;}
      };
      form.elements.shopName.oninput=()=>form.elements.shopName.setCustomValidity('');
    });
  }
  function mount(u,{navigate}) {
    start(u);billing($('testBillingRoot'));
    const guide=$('clientGuide');
    const paint=()=>{guide.hidden=store.state.guideHidden;};
    guide.innerHTML=`<div class="client-section-head"><div><h2>Начало работы</h2><p>Три шага к первому расчёту. Уже работаете? Эту подсказку можно скрыть.</p></div><button class="ghost small" type="button" data-guide-hide>Скрыть</button></div><ol class="client-guide-steps"><li><button type="button" data-guide-view="settings">Подключите данные</button><span>WB — API в настройках. Ozon — файл в разделе «Отчёты».</span><a href="#reports" data-guide-view="reports">Загрузить отчёт Ozon</a></li><li><button type="button" data-guide-view="costs">Добавьте себестоимость</button><span>Одинаковая для WB и Ozon. Проверьте ставку налога в настройках.</span></li><li><button type="button" data-guide-view="overview">Откройте обзор</button><span>Выберите площадку и период. Расчёт появится после загрузки данных.</span></li></ol><div class="client-guide-footer"><a href="/demo.html" target="_blank" rel="noopener">Посмотреть пример в демо</a><button class="ghost small" type="button" data-guide-view="account">Тариф и тестовая оплата</button></div>`;
    guide.querySelector('[data-guide-hide]').onclick=()=>{store.guide(true);paint();$('showClientGuide').focus();};
    guide.querySelector('[data-guide-view="reports"]').dataset.guideMarketplace='ozon';
    guide.querySelectorAll('[data-guide-view]').forEach(button=>button.onclick=e=>{e.preventDefault();navigate(button.dataset.guideView,button.dataset.guideMarketplace);});
    $('showClientGuide').onclick=()=>{store.guide(false);paint();navigate('overview');guide.scrollIntoView({block:'start'});};paint();
  }
  window.WBClientStart={firstShop,mount};
})();
