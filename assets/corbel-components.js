// Shared presentation components. Native selects remain the source of truth;
// their original change handlers, values and disabled states are untouched.
(function () {
  'use strict';
  const shell = window.WBShell;
  if (!shell) return;
  const controls = new Map();
  let openControl = null, sequence = 0;
  const reduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function close(restoreFocus = false) {
    if (!openControl) return;
    const state = openControl; openControl = null;
    state.button.setAttribute('aria-expanded', 'false');
    if (state.menu.hidePopover && state.menu.matches(':popover-open')) state.menu.hidePopover();
    state.menu.hidden = true;
    state.button.removeAttribute('aria-activedescendant');
    if (restoreFocus && !state.button.disabled) state.button.focus({ preventScroll: true });
  }
  function position(state) {
    const rect = state.button.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 220), innerWidth - 24);
    const height = Math.min(state.select.options.length * 40 + 12, 300, innerHeight - 32);
    const below = innerHeight - rect.bottom - 12;
    const top = below >= Math.min(height, 160) ? rect.bottom + 6 : Math.max(12, rect.top - height - 6);
    Object.assign(state.menu.style, { width: `${width}px`, left: `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`, top: `${top}px`, maxHeight: `${Math.max(80, Math.min(height, innerHeight - top - 12))}px` });
  }
  function highlight(state, index) {
    const options = [...state.menu.querySelectorAll('[role=option]')];
    const enabled = options.filter(option => option.getAttribute('aria-disabled') !== 'true');
    const active = options[index];
    if (!active || !enabled.includes(active)) return;
    state.active = index;
    state.activeOption = state.select.options[Number(active.dataset.index)];
    options.forEach((option, i) => option.classList.toggle('is-highlighted', i === index));
    state.button.setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView({ block: 'nearest' });
  }
  function draw(state) {
    state.menu.replaceChildren();
    [...state.select.options].forEach((option, index) => {
      if (option.hidden || option.parentElement?.hidden) return;
      const item = document.createElement('div'); item.className = 'select-menu-option';
      item.id = `${state.menu.id}-${index}`; item.dataset.index = index;
      item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(option.selected));
      item.setAttribute('aria-disabled', String(option.disabled || option.parentElement?.disabled === true));
      const label = document.createElement('span'); label.textContent = option.textContent;
      item.append(label); state.menu.append(item);
    });
  }
  function reconcile(state, preferred) {
    const items = [...state.menu.children];
    const enabled = item => item.getAttribute('aria-disabled') !== 'true';
    let index = preferred ? items.findIndex(item => enabled(item) && state.select.options[Number(item.dataset.index)] === preferred) : -1;
    if (index < 0) index = items.findIndex(item => enabled(item) && item.getAttribute('aria-selected') === 'true');
    if (index < 0) index = items.findIndex(enabled);
    if (index >= 0) highlight(state, index);
    else { state.active = -1; state.activeOption = null; state.button.removeAttribute('aria-activedescendant'); }
  }
  function sync(state) {
    state.wrap.hidden = state.select.hidden;
    state.label.textContent = state.select.selectedOptions[0]?.textContent || 'Нет доступных значений';
    state.button.disabled = state.select.disabled || !state.select.options.length;
    const label = state.select.getAttribute('aria-label') || [...(state.select.labels || [])].map(el => el.textContent.trim()).join(' ') || 'Выбрать значение';
    state.button.setAttribute('aria-label', label);
    state.menu.setAttribute('aria-label', label);
    state.button.title = state.label.textContent;
    if (state.select.required) state.button.setAttribute('aria-required', 'true'); else state.button.removeAttribute('aria-required');
    if (state.select.hasAttribute('aria-invalid')) state.button.setAttribute('aria-invalid', state.select.getAttribute('aria-invalid'));
    else state.button.removeAttribute('aria-invalid');
    if (openControl === state) {
      if (state.button.disabled || state.select.hidden) close();
      else { const preferred = state.activeOption; draw(state); position(state); reconcile(state, preferred); }
    }
  }
  function choose(state, index) {
    const option = state.select.options[index];
    if (!option || option.disabled || option.parentElement?.disabled === true) return;
    const changed = state.select.selectedIndex !== index;
    state.select.selectedIndex = index; sync(state); close(true);
    if (changed) {
      state.select.dispatchEvent(new Event('input', { bubbles: true }));
      state.select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  function open(state) {
    if (state.button.disabled) return;
    close(); sync(state); draw(state); openControl = state;
    state.menu.hidden = false; position(state);
    if (state.menu.showPopover) state.menu.showPopover();
    state.button.setAttribute('aria-expanded', 'true');
    reconcile(state);
    if (!reduce()) state.menu.animate([{ opacity: 0, transform: 'translateY(-8px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 400, easing: 'cubic-bezier(.34,1.56,.64,1)' });
  }
  function enhance(select) {
    if (controls.has(select) || select.multiple || select.size > 1) return;
    const wrap = document.createElement('span'); wrap.className = 'corbel-select';
    select.before(wrap); wrap.append(select); select.classList.add('corbel-select-native');
    select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
    const button = document.createElement('button'); button.className = 'select-trigger'; button.type = 'button';
    button.setAttribute('role', 'combobox'); button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-haspopup', 'listbox');
    const menu = document.createElement('div'); menu.className = 'corbel-select-menu'; menu.hidden = true; menu.id = `seller-select-${++sequence}`;
    menu.setAttribute('role', 'listbox'); if (menu.showPopover) menu.setAttribute('popover', 'manual');
    button.setAttribute('aria-controls', menu.id);
    const label = document.createElement('span'); label.className = 'select-value'; button.append(label);
    button.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>');
    wrap.append(button); document.body.append(menu);
    const state = { select, wrap, button, label, menu, active: 0, activeOption: null, query: '', typedAt: 0 }; controls.set(select, state);
    button.addEventListener('click', () => openControl === state ? close() : open(state));
    button.addEventListener('focus', () => sync(state));
    select.addEventListener('focus', () => button.focus());
    select.addEventListener('change', () => sync(state));
    menu.addEventListener('pointermove', e => {
      const option = e.target.closest('[role=option]'); if (option) highlight(state, [...menu.children].indexOf(option));
    });
    menu.addEventListener('pointerdown', e => e.preventDefault());
    menu.addEventListener('click', e => { const option = e.target.closest('[role=option]'); if (option) choose(state, Number(option.dataset.index)); });
    button.addEventListener('keydown', e => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        if (openControl !== state) { open(state); return; }
        const items = [...menu.children], enabled = items.map((item, i) => item.getAttribute('aria-disabled') === 'true' ? -1 : i).filter(i => i >= 0);
        if (!enabled.length) return;
        const current = enabled.indexOf(state.active);
        const next = e.key === 'Home' ? enabled[0] : e.key === 'End' ? enabled.at(-1) : enabled[(current + (e.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length];
        highlight(state, next);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); if (openControl === state) choose(state, Number(menu.children[state.active]?.dataset.index)); else open(state);
      } else if (e.key === 'Escape') { if (openControl === state) { e.preventDefault(); close(true); } }
      else if (e.key === 'Tab') close();
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault(); if (openControl !== state) open(state);
        const now = performance.now(); state.query = now - state.typedAt > 750 ? e.key : state.query + e.key; state.typedAt = now;
        const found = [...menu.children].findIndex(item => item.textContent.toLocaleLowerCase().startsWith(state.query.toLocaleLowerCase()) && item.getAttribute('aria-disabled') !== 'true');
        if (found >= 0) highlight(state, found);
      }
    });
    new MutationObserver(() => sync(state)).observe(select, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'selected', 'label', 'hidden', 'required', 'aria-label', 'aria-invalid'] });
    sync(state);
  }
  function layout() {
    const trend = document.getElementById('secTrend'), expense = document.querySelector('.expense-card');
    if (!trend || !expense || document.querySelector('.overview-chart-deck')) return;
    const expenseSection = expense.parentElement;
    const deck = document.createElement('section'); deck.id = 'secOverviewCharts'; deck.className = 'overview-chart-deck app-view'; deck.dataset.view = 'overview';
    deck.classList.toggle('is-active', trend.classList.contains('is-active'));
    trend.before(deck); trend.classList.remove('app-view', 'is-active'); trend.removeAttribute('hidden');
    const gauge = document.createElement('div'); gauge.className = 'card profitability-card';
    gauge.innerHTML = `<h2>Рентабельность <span class="gauge-info" title="Чистая прибыль ÷ сумма продаж × 100%. Это фактическая доля прибыли, не рейтинг магазина.">i</span></h2>
      <div class="gauge-figure"><svg id="profitabilityGauge" viewBox="0 0 320 190" role="img" aria-label="Рентабельность: недостаточно данных">
      <defs><linearGradient id="profitGradient"><stop stop-color="#93a3ec"/><stop offset="1" stop-color="#2a45cc"/></linearGradient></defs>
      <g class="gauge-ticks"></g><path class="gauge-track" d="M40 154 A120 120 0 0 1 280 154"/>
      <path class="gauge-arc" id="profitabilityArc" pathLength="100" d="M40 154 A120 120 0 0 1 280 154"/>
      <circle id="profitabilityMarker" cx="40" cy="154" r="9" visibility="hidden"/></svg>
      <div class="gauge-number"><strong id="profitabilityValue">—</strong><span class="gauge-delta" id="profitabilityDelta"></span><small>% от суммы продаж</small></div></div>
      <h3 id="profitabilityCaption">Заполните недостающие данные</h3><p id="profitabilityNote">Для расчёта нужны продажи и чистая прибыль.</p>
      <button class="gauge-details" type="button">Структура расходов <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg></button>`;
    for (let i=0;i<=40;i++) {
      const angle=Math.PI-i/40*Math.PI, tick=document.createElementNS('http://www.w3.org/2000/svg','line');
      const inner=i%5===0?135:139, outer=146;
      tick.setAttribute('x1',String(160+inner*Math.cos(angle)));tick.setAttribute('y1',String(154-inner*Math.sin(angle)));
      tick.setAttribute('x2',String(160+outer*Math.cos(angle)));tick.setAttribute('y2',String(154-outer*Math.sin(angle)));
      tick.dataset.gaugeTick=String(i);gauge.querySelector('.gauge-ticks').append(tick);
    }
    expenseSection.classList.add('expense-panel'); expenseSection.id='secExpenseSummary';
    deck.append(gauge, trend);
    gauge.querySelector('button').addEventListener('click',()=>expenseSection.scrollIntoView({behavior:reduce()?'instant':'smooth',block:'start'}));
    const advertising=document.createElement('section'); advertising.className='section app-view advertising-section';advertising.dataset.view='overview';advertising.id='secAdvertising';
    advertising.classList.toggle('is-active',deck.classList.contains('is-active'));
    const advertisingHeading=document.createElement('div');advertisingHeading.className='section-head';
    const h2=document.createElement('h2');h2.textContent='Реклама и продвижение';advertisingHeading.append(h2);
    const second=document.createElement('div');second.id='secondaryKpiRow';second.className='kpi-row secondary-kpis';advertising.append(advertisingHeading,second);deck.after(advertising);
    [...document.querySelectorAll('#kpiRow>.kpi')].slice(4).forEach(card=>second.append(card));
    [expenseSection, trend, document.querySelector('.sku-card')?.parentElement].filter(Boolean).forEach(section => {
      const heading = section.querySelector('.section-head'), card = section.querySelector('.card');
      if (heading && card) { heading.classList.add('panel-heading'); card.prepend(heading); }
    });
  }
  function wire() {
    layout(); document.querySelectorAll('select').forEach(enhance);
    document.addEventListener('pointerdown', e => { if (openControl && !openControl.menu.contains(e.target) && !openControl.button.contains(e.target)) close(); });
    window.addEventListener('resize', () => close());
    window.addEventListener('scroll', e => { if (openControl && !openControl.menu.contains(e.target)) close(); }, true);
    window.addEventListener('seller:themechange', () => close());
  }
  shell.components = { refreshSelects: () => controls.forEach(sync), closeSelect: close };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire, { once: true }); else wire();
})();
