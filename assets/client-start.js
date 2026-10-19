(function () {
  'use strict';
  const $=(id)=>document.getElementById(id);
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rub=n=>new Intl.NumberFormat('ru-RU').format(n)+' ₽';
  const date=s=>new Date(s).toLocaleDateString('ru-RU');
  let store,user;
  function start(u) {if(user===u.id)return;user=u.id;let storage;try{storage=window.localStorage;}catch{storage=null;}store=WBTestSubscription.create(user,storage);}
  function billing(root) {
    if(!root)return;
    const paint=()=>{
      const state=store.state,s=state.subscription,p=WBTestSubscription.PLANS.find(p=>p.id===s?.plan);
      root.innerHTML=`<section class="client-billing" aria-label="Тестовая подписка"><div class="client-section-head"><div><h2>Тариф и подписка</h2><p>Выберите тариф и проверьте сценарий оплаты.</p></div><span class="client-test-badge">Тестовый режим</span></div>
        <p class="client-test-note">Это симуляция: карта не нужна, деньги не списываются, автоплатежей нет. Выбор хранится только в этом браузере и не меняет ваш доступ к платформе.</p>
        <div class="client-plans">${WBTestSubscription.PLANS.map(plan=>`<article class="client-plan"><h3>${plan.name}</h3><p class="client-price">${rub(plan.price)}<span> / месяц</span></p><p>До ${plan.shops} магазинов<br>До ${plan.employees} сотрудников</p><button type="button" class="${p?.id===plan.id&&s.status==='active'?'ghost':'primary'}" data-test-plan="${plan.id}">${p?.id===plan.id&&s.status==='active'?'Повторить тест оплаты':'Протестировать оплату'}</button></article>`).join('')}</div>
        <p class="client-count-note">Wildberries и Ozon считаются двумя магазинами, даже если объединены под одним названием. Лимиты показаны для будущей подписки и сейчас не ограничивают работу.</p>
        <div class="client-checkout" hidden tabindex="-1" aria-label="Подтверждение тестовой оплаты"><h3>Тестовая оплата</h3><p data-checkout-summary></p><p>Смоделируйте результат. Настоящего платежа не будет.</p><div class="client-actions"><button type="button" class="primary" data-result="success">Успешная оплата</button><button type="button" class="ghost" data-result="declined">Оплата отклонена</button><button type="button" class="ghost" data-result="cancelled">Отмена</button></div></div>
        <div class="client-payment-status" role="status" aria-live="polite">${s?`<strong>${s.status==='active'?'Тестовая подписка активна':'Тестовая подписка отменена'}</strong><p>${p.name} · ${rub(p.price)} в месяц${s.status==='active'?` · тестовый период до ${date(s.until)}`:''}. Реальных списаний нет.</p>`:'Тестовая подписка пока не оформлена.'}</div>
        ${s?.status==='active'?'<button type="button" class="ghost small" data-cancel-sub>Отменить тестовую подписку</button>':''}
        ${state.history.length?`<details class="client-history"><summary>История тестов (${state.history.length})</summary><ul>${state.history.map(h=>`<li><span>${date(h.at)} · ${esc(WBTestSubscription.PLANS.find(p=>p.id===h.plan).name)}</span><strong>${({success:'Успешно · тест',declined:'Отклонено · тест',cancelled:'Отменено'})[h.status]}</strong></li>`).join('')}</ul></details>`:''}
        <p class="client-storage-note">${store.persistent?'Тестовое состояние привязано к вашему аккаунту на этом устройстве.':'Браузер не сохраняет данные. Тестовое состояние исчезнет после закрытия страницы.'}</p></section>`;
      let trigger=null,busy=false,attemptId=null;
      const checkout=root.querySelector('.client-checkout');
      root.querySelectorAll('[data-test-plan]').forEach(button=>button.onclick=()=>{
        if(!checkout.hidden)return checkout.focus();
        trigger=button;const plan=WBTestSubscription.PLANS.find(p=>p.id===button.dataset.testPlan);
        attemptId=store.begin(plan.id).id;checkout.hidden=false;checkout.querySelector('[data-checkout-summary]').textContent=`${plan.name} — ${rub(plan.price)} за месяц. До ${plan.shops} магазинов и ${plan.employees} сотрудников.`;
        checkout.focus();checkout.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
      });
      checkout.querySelectorAll('[data-result]').forEach(button=>button.onclick=async()=>{
        if(busy)return;busy=true;const status=button.dataset.result,plan=trigger?.dataset.testPlan;
        // Commit the exact attempt before any animation or shop-creation await.
        if(!store.finish(status,attemptId)){paint();return;}
        checkout.setAttribute('aria-busy','true');checkout.querySelectorAll('button').forEach(b=>b.disabled=true);button.textContent='Проверяем тестовый результат…';
        await new Promise(resolve=>setTimeout(resolve,350));
        if(!root.isConnected||!checkout.isConnected||root.closest('[hidden]'))return;
        paint();
        const statusNode=root.querySelector('.client-payment-status');
        statusNode.textContent=status==='success'?'Тест прошёл: подписка активна. Деньги не списаны.':status==='declined'?'Тест: оплата отклонена. Вы можете попробовать снова; доступ к магазину не изменился.':'Тестовая оплата отменена. Доступ к магазину не изменился.';
        root.querySelector(`[data-test-plan="${plan}"]`)?.focus({preventScroll:true});
      });
      root.querySelector('[data-cancel-sub]')?.addEventListener('click',()=>{store.cancel();paint();root.querySelector('[data-test-plan]')?.focus({preventScroll:true});});
    };paint();
  }
  function firstShop(u,{createShop,signOut}) {
    start(u);const root=$('clientWelcome');
    $('loadingScreen').hidden=true;root.hidden=false;
    root.innerHTML=`<div class="client-welcome-top"><a href="/demo.html">Посмотреть демо</a><button type="button" class="ghost" data-welcome-exit>Выйти</button></div><div class="client-welcome-intro"><img src="/assets/icons/icon.svg" width="42" height="42" alt=""><h1>Начнём с вашего магазина</h1><p>Подключите Wildberries или загрузите отчёт Ozon — и увидите продажи, расходы и прибыль. Тестовая оплата необязательна.</p></div><div class="client-welcome-layout"><form class="client-setup"><h2>Создать свой магазин</h2><label for="welcomeShopName">Название магазина</label><input id="welcomeShopName" name="shopName" required maxlength="80" autocomplete="organization" placeholder="Например, Мой бренд"><fieldset><legend>С какой площадки начнём?</legend><label><input type="radio" name="marketplace" value="wildberries" checked>Wildberries <span>Подключение API в настройках</span></label><label><input type="radio" name="marketplace" value="ozon">Ozon <span>Загрузка отчёта по начислениям</span></label></fieldset><p class="client-count-note">Вторую площадку можно добавить в этот же магазин позже. В тарифе она займёт ещё одно место.</p><button class="primary" type="submit">Создать и продолжить</button><p class="client-form-status" role="status" aria-live="polite"></p></form><div id="welcomeBilling"></div></div>`;
    billing($('welcomeBilling'));root.querySelector('[data-welcome-exit]').onclick=signOut;
    return new Promise(resolve=>{
      const form=root.querySelector('form');let busy=false;
      form.onsubmit=async e=>{e.preventDefault();if(busy)return;
        const name=form.elements.shopName.value.trim();if(!name){form.elements.shopName.setCustomValidity('Введите название магазина');form.elements.shopName.reportValidity();return;}
        busy=true;const submit=form.querySelector('[type="submit"]'),status=form.querySelector('[role="status"]');submit.disabled=true;submit.textContent='Создаём магазин…';status.textContent='';
        const marketplace=form.elements.marketplace.value;
        try {const shop=await createShop(name,marketplace);if(!shop?.id)throw new Error('Магазин не был создан');store.finish('cancelled');store.guide(false);root.hidden=true;$('loadingScreen').hidden=false;resolve({shop,marketplace});}
        catch(error){status.textContent='Не удалось создать магазин. Проверьте соединение и попробуйте снова.';submit.disabled=false;submit.textContent='Создать и продолжить';busy=false;}
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
