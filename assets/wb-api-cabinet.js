(function () {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => value == null ? '—' : Number(value).toLocaleString('ru-RU', {maximumFractionDigits:2}) + ' ₽';
  const number = value => value == null ? '—' : Number(value).toLocaleString('ru-RU');
  let context = null, epoch = 0, timer = null, busy = false, cabinet = null, trend = [], trendMetric = 'profit', dirty = false, reloadQueued = false;
  const now = new Date(), closed = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const defaultMonth = `${closed.getFullYear()}-${String(closed.getMonth() + 1).padStart(2,'0')}`;
  el('apiCabinetMonth').value = defaultMonth;
  el('apiCabinetMonth').max = defaultMonth;
  const oldest = new Date(now.getTime() - 365 * 86400000);
  oldest.setMonth(oldest.getMonth() + 1);
  el('apiCabinetMonth').min = `${oldest.getFullYear()}-${String(oldest.getMonth() + 1).padStart(2,'0')}`;
  const status = (message, error = false) => { el('apiCabinetStatus').textContent = message; el('apiCabinetStatus').dataset.error = String(error); };
  function render() {
    const loading = cabinet?.job?.status === 'loading';
    el('apiCabinetSync').disabled = busy || loading;
    el('apiCabinetRefresh').disabled = busy || loading;
    el('apiCabinetRefresh').hidden = !cabinet?.complete;
    el('apiCabinetMonth').disabled = busy;
    el('apiCabinetSync').textContent = loading ? 'Загрузка на сервере' : cabinet?.job?.status === 'error' ? 'Повторить загрузку' : cabinet?.complete ? 'Обновить расчёт' : 'Загрузить данные';
    for (const id of ['apiOperationalExpenses','apiExternalExpenses','apiMediaExpenses']) el(id).disabled = busy || !context?.allowed;
    el('apiSaveExpenses').disabled = busy || !context?.allowed || !dirty;
    const sources = cabinet?.sources || {};
    const labels = {downloaded:'Получено из API',loading:'Загружается',pending:'Ожидает загрузки',confirmed_by_user:'Подтверждено владельцем',needs_confirmation:'Нужно подтверждение'};
    el('apiCabinetSources').innerHTML = [['finance','Финансы'],['orders','Заказы'],['ads','Внутренняя реклама'],['media','WB Media']].map(([key,label]) => {
      const state = sources[key]?.status || 'pending';
      return `<li><span>${label}</span><strong data-state="${esc(state)}">${esc(labels[state] || 'Требует проверки')}</strong></li>`;
    }).join('');
    const f = cabinet?.finance, orders = sources.orders?.status === 'downloaded' ? sources.orders : null;
    const ads = sources.ads?.status === 'downloaded' ? sources.ads.totals : null;
    const e = cabinet?.economy;
    const balance = ads ? e?.internal_ads ?? ads['Баланс']?.amount ?? 0 : null;
    const media = ['confirmed_by_user','downloaded'].includes(sources.media?.status) ? sources.media.amount : null;
    const metrics = [
      ['Чистая прибыль', money(cabinet?.net_profit), e?.missing?.length ? e.missing.join(' · ') : 'После себестоимости, налога и всех указанных расходов', 'profit'],
      ['Сумма заказов', money(orders?.amount), 'Воронка продаж · по дате заказа', 'orders'],
      ['Продажи по финансовому отчёту', money(f?.retailAmount), 'Продажи минус возвраты · цена из финансовой детализации', 'sales'],
      ['Итого к перечислению (WB)', money(e?.payout), 'После удержаний и компенсаций из финансового отчёта', 'transfer'],
      ['Внутренняя реклама', money(balance), 'Баланс + счёт · без бонусов и рекламного кэшбэка', 'internalAds'],
      ['WB Media', money(media), media == null ? 'Нет подтверждённой суммы' : sources.media.status === 'confirmed_by_user' ? 'Подтверждено владельцем, не API' : 'Получено из API', 'mediaAds'],
      ['ДРР (заказа)', e?.drr_orders == null ? '—' : number(Number(e.drr_orders.toFixed(1))) + ' %', 'Внутренняя + медийная + внешняя реклама / заказы', 'drrOrders'],
      ['ДРР (выкупа)', e?.drr_sales == null ? '—' : number(Number(e.drr_sales.toFixed(1))) + ' %', 'Вся денежная реклама / продажи финансового отчёта', 'drrSales'],
      ['Заказали', number(orders?.count) + (orders ? ' шт.' : ''), 'Все товары, включая удалённые карточки'],
      ['Выкупили', f ? number(f.bought_qty) + ' шт.' : '—', 'Без повторного количества в корректировках'],
      ['Себестоимость выкупов', money(cabinet?.cogs), 'Текущая себестоимость × продажи минус возвраты'],
      ['Операционные расходы', money(cabinet?.settings?.operational_expenses), 'Указаны вручную за выбранный месяц'],
      ['Внешнее продвижение', money(cabinet?.settings?.external_promotion_expenses), 'Указано вручную за выбранный месяц'],
      ['Налог', money(e?.tax), `Ставка ${number(cabinet?.shop?.tax_rate)}% от продаж финансового отчёта`],
    ];
    if (Number(e?.promo)) metrics.push(['Промобонусы и рекламный кэшбэк', money(e.promo), 'Справочно · не уменьшают прибыль', 'promo']);
    const focusedMetric = document.activeElement?.dataset?.apiMetric;
    el('apiCabinetMetrics').innerHTML = metrics.map(([title,value,hint,metric])=>`<${metric ? 'button type="button"' : 'div'} class="kpi"${metric ? ` data-api-metric="${metric}" aria-pressed="${metric === trendMetric}" title="Показать динамику: ${title}"` : ''}><span class="api-metric-label">${title}</span><strong class="api-metric-value">${esc(value)}</strong><span class="hint">${hint}</span></${metric ? 'button' : 'div'}>`).join('');
    if (focusedMetric) el('apiCabinetMetrics').querySelector?.(`[data-api-metric="${focusedMetric}"]`)?.focus({preventScroll:true});
    const pairs = rows => rows.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('');
    el('apiCabinetFinance').innerHTML = pairs([
      ['К перечислению за товар', money(f?.forPay)], ['Логистика', money(f?.deliveryService)], ['Хранение', money(f?.paidStorage)],
      ['Приёмка', money(f?.paidAcceptance)], ['Штрафы', money(f?.penalty)], ['Прочие удержания', money(f?.deduction)],
      ['Корректировка вознаграждения WB', money(f?.additionalPayment)],
      ['Баллы за отзывы и лояльность, нетто', money(f?.cashbackAmount)], ['Комиссия лояльности', money(f?.cashbackCommissionChange)], ['Компенсация скидки лояльности', money(f?.cashbackDiscount)],
      ['Реклама в удержаниях (без повторного вычета)', money(e?.advertising_already_withheld)],
    ]);
    el('apiCabinetAds').innerHTML = ads && Object.keys(ads).length ? pairs(Object.entries(ads).map(([type,data])=>[type,money(data.amount)])) : '<p class="hint">Рекламные списания пока не получены.</p>';
    const missing = cabinet?.missing_costs?.length || 0;
    el('apiCabinetReadiness').innerHTML = [
      cabinet?.finance ? missing ? `Себестоимость не заполнена: ${missing} товаров с выкупами.` : 'Себестоимость заполнена для товаров с выкупами.' : 'Себестоимость проверим после загрузки финансов.',
      `Ставка налога: ${number(cabinet?.shop?.tax_rate)}%. Проверьте в настройках.`,
      `Себестоимость выкупов: ${money(cabinet?.cogs)}.`,
      sources.ads?.undated ? `Списания без даты: ${sources.ads.undated}. Не распределены по месяцам.` : 'Реклама распределяется по дате списания, время Москвы.',
    ].map(s=>`<li>${esc(s)}</li>`).join('');
    el('apiCabinetWarning').textContent = cabinet?.complete ? 'Прибыль = к перечислению после удержаний − себестоимость − налог − внутренняя и медийная реклама − операционные расходы − внешнее продвижение. Реклама, уже включённая в удержания, не вычитается повторно. Бонусы — справочно. Данные API не публикуются в витрине.' : 'Загрузите закрытый месяц. Сервер последовательно получит финансы, заказы и внутреннюю рекламу; данные других магазинов не изменятся.';
    const products = [...(cabinet?.products || [])].sort((a,b)=>Number(b.orders_amount || 0)-Number(a.orders_amount || 0));
    el('apiCabinetProducts').innerHTML = products.length ? products.map(p=>`<tr><td><strong>${esc(p.name || p.article)}</strong><small>${esc(p.article)}</small></td><td>${number(p.orders_count)}</td><td>${money(p.orders_amount)}</td><td>${number(p.bought_qty)}</td><td>${money(p.for_pay)}</td><td>${Number(p.cost_price)>0 ? money(p.cost_price) : 'Не заполнена'}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">Товары появятся после загрузки API.</td></tr>';
  }
  function fillExpenses() {
    const settings = cabinet?.settings || {};
    el('apiOperationalExpenses').value = settings.operational_expenses ?? 0;
    el('apiExternalExpenses').value = settings.external_promotion_expenses ?? 0;
    const media = cabinet?.sources?.media;
    el('apiMediaExpenses').value = settings.media_spend ?? (media?.status === 'confirmed_by_user' ? media.amount : '') ?? '';
    dirty = false;
  }
  function renderTrend() {
    el('apiTrendEmpty').hidden = trend.length > 0;
    document.querySelectorAll('#apiTrendControls [data-metric]').forEach(button => {
      button.classList.toggle('active', button.dataset.metric === trendMetric);
      button.setAttribute('aria-pressed', String(button.dataset.metric === trendMetric));
    });
    window.WBDashboard?.renderTrend(el('apiTrendChart'), trend, trendMetric, 'wildberries');
    const metric = window.WBDashboard?.getTrendMetric?.(trendMetric,'wildberries') || {label:trendMetric,unit:'₽'};
    const rows = trend.map(point => {
      const month = new Date(point.year, point.month - 1, 1).toLocaleDateString('ru-RU',{month:'long',year:'numeric'});
      const value = point[trendMetric] == null ? 'Нет данных' : metric.unit === '%' ? number(Number(point[trendMetric].toFixed(1))) + ' %' : money(point[trendMetric]);
      return `<div><span>${esc(month)}</span><strong>${esc(value)}</strong></div>`;
    }).join('');
    el('apiTrendValues').innerHTML = trend.length ? `<p>${esc(metric.label)} по месяцам</p>${rows}` : '';
    el('apiTrendChart').setAttribute?.('aria-label',`${metric.label}: динамика сохранённых месяцев API`);
  }
  async function load(action = 'cabinet', refresh = false) {
    if (!context?.allowed || busy) return;
    const current = ++epoch, shopId = context.shopId, month = el('apiCabinetMonth').value;
    clearTimeout(timer); busy = true; render();
    status(action === 'cabinet_start' ? 'Ставим загрузку в очередь сервера…' : 'Читаем сохранённые данные…');
    try {
      const result = await window.WBApi.cabinet(action, month, refresh);
      if (current !== epoch || context.shopId !== shopId) return;
      cabinet = result.cabinet;
      if (!dirty) fillExpenses();
      let history;
      try { history = await window.WBApi.cabinet('cabinet_trend', month); }
      catch { history = {trend:[]}; el('apiTrendEmpty').textContent = 'Не удалось прочитать динамику. Нажмите «Обновить расчёт».'; }
      if (current !== epoch || context.shopId !== shopId) return;
      trend = history.trend || []; renderTrend();
      const job = cabinet.job;
      if (!job) status('За этот месяц выгрузки нет. Нажмите «Загрузить данные».');
      else if (job.status === 'loading') {
        const stage = {finance:'финансы',orders:'заказы',ads:'внутренняя реклама'}[job.stage] || 'финансы';
        status(`Загружаются ${stage}. Сохранено ${number(job.row_count)} финансовых операций. Можно закрыть страницу.${job.error_message ? ' Последняя попытка: ' + job.error_message : ''}`);
      } else if (job.status === 'error') status(job.error_message || 'Загрузка остановлена. Проверьте ключ и повторите.', true);
      else status(`${cabinet.complete ? 'Выгрузка готова' : 'Получена часть источников'} · ${new Date(job.updated_at).toLocaleString('ru-RU')}.`);
    } catch (error) { if (current === epoch) status(error.message, true); }
    finally {
      if (current === epoch) { busy = false; render(); if (reloadQueued) { reloadQueued = false; load(); } else if (cabinet?.job?.status === 'loading') timer = setTimeout(()=>load(),15000); }
    }
  }
  function setContext(next) {
    if (context?.shopId === next.shopId && context?.allowed === next.allowed) return;
    context = {...next}; ++epoch; clearTimeout(timer); busy = false; cabinet = null; trend = []; dirty = false; reloadQueued = false;
    el('secApiCabinet').hidden = !next.allowed;
    el('apiCabinetMonth').value = defaultMonth;
    status(''); fillExpenses(); render(); renderTrend();
    if (next.allowed) load();
  }
  el('apiCabinetMonth').addEventListener('change',()=>{ cabinet = null; dirty = false; fillExpenses(); el('apiExpensesStatus').textContent = ''; render(); load(); });
  el('apiCabinetSync').addEventListener('click',()=>load(cabinet?.complete ? 'cabinet' : 'cabinet_start'));
  el('apiCabinetRefresh').addEventListener('click',()=>load('cabinet_start',true));
  for (const id of ['apiOperationalExpenses','apiExternalExpenses','apiMediaExpenses']) el(id).addEventListener('input',()=>{ dirty = true; el('apiSaveExpenses').disabled = busy || !context?.allowed; });
  el('apiCabinetExpensesForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!context?.allowed || busy || !dirty) return;
    const current = ++epoch, shopId = context.shopId, month = el('apiCabinetMonth').value;
    const payload = { operational_expenses: el('apiOperationalExpenses').value, external_promotion_expenses: el('apiExternalExpenses').value, media_spend: el('apiMediaExpenses').value || null };
    clearTimeout(timer); busy = true; render();
    try {
      const result = await window.WBApi.cabinet('cabinet_settings',month,false,payload);
      if (current !== epoch || context.shopId !== shopId) return;
      cabinet = result.cabinet; fillExpenses();
      const e = cabinet.economy;
      trend = trend.map(point => `${point.year}-${String(point.month).padStart(2,'0')}` === month ? {...point, profit:e?.net_profit == null ? null : Number(e.net_profit), mediaAds:cabinet.sources.media.amount == null ? null : Number(cabinet.sources.media.amount), drrOrders:e?.drr_orders ?? null, drrSales:e?.drr_sales ?? null} : point);
      renderTrend();
      el('apiExpensesStatus').textContent = 'Расходы сохранены'; el('apiExpensesStatus').dataset.error = 'false';
    } catch (error) { if (current === epoch) { el('apiExpensesStatus').textContent = error.message; el('apiExpensesStatus').dataset.error = 'true'; } }
    finally { if (current === epoch) { busy = false; render(); if (reloadQueued) { reloadQueued = false; load(); } else if (cabinet?.job?.status === 'loading') timer = setTimeout(()=>load(),15000); } }
  });
  const selectMetric = metric => {
    trendMetric = metric;
    document.querySelectorAll('#apiCabinetMetrics [data-api-metric]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.apiMetric === trendMetric)));
    renderTrend();
  };
  document.querySelectorAll('#apiTrendControls [data-metric]').forEach(button => button.addEventListener('click',()=>selectMetric(button.dataset.metric)));
  el('apiCabinetMetrics').addEventListener('click',event=>{ const card = event.target.closest('[data-api-metric]'); if (card) selectMetric(card.dataset.apiMetric); });
  window.WBApiCabinet = {setContext, reload:()=>{ if (!context?.allowed) return; if (busy) reloadQueued = true; else load(); }};
})();
