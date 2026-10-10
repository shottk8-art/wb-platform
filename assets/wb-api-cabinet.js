(function () {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => value == null ? '—' : Number(value).toLocaleString('ru-RU', {maximumFractionDigits:2}) + ' ₽';
  const number = value => value == null ? '—' : Number(value).toLocaleString('ru-RU');
  let context = null, epoch = 0, requestId = 0, timer = null, busy = false, cabinet = null, dirty = false, reloadQueued = false;
  let cache = new Map(), historyPromise = null;
  const listeners = new Set();
  const now = new Date(), closed = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const defaultMonth = `${closed.getFullYear()}-${String(closed.getMonth() + 1).padStart(2,'0')}`;
  el('apiCabinetMonth').value = el('apiCabinetMonth').max = defaultMonth;
  const oldest = new Date(now.getTime() - 365 * 86400000);
  oldest.setMonth(oldest.getMonth() + 1);
  el('apiCabinetMonth').min = `${oldest.getFullYear()}-${String(oldest.getMonth() + 1).padStart(2,'0')}`;
  const status = (message, error = false) => { el('apiCabinetStatus').textContent = message; el('apiCabinetStatus').dataset.error = String(error); };
  const changed = () => listeners.forEach(listener => listener());
  const invalidate = () => { cache = new Map(); historyPromise = null; };
  const pairs = rows => rows.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('');
  function render() {
    const loading = cabinet?.job?.status === 'loading';
    el('apiCabinetSync').disabled = busy || loading || !context?.allowed;
    el('apiCabinetRefresh').disabled = busy || loading || !context?.allowed;
    el('apiCabinetRefresh').hidden = !cabinet?.complete;
    el('apiCabinetMonth').disabled = busy;
    el('apiCabinetSync').textContent = loading ? 'Загрузка на сервере' : cabinet?.job?.status === 'error' ? 'Повторить загрузку' : cabinet?.complete ? 'Обновить расчёт' : 'Загрузить данные';
    for (const id of ['apiOperationalExpenses','apiExternalExpenses','apiMediaExpenses']) el(id).disabled = busy || !context?.allowed;
    el('apiSaveExpenses').disabled = busy || !context?.allowed || !dirty;
    const sources = cabinet?.sources || {}, f = cabinet?.finance;
    const labels = {downloaded:'Получено из API',loading:'Загружается',pending:'Ожидает загрузки',confirmed_by_user:'Подтверждено владельцем',needs_confirmation:'Нужно подтверждение'};
    el('apiCabinetSources').innerHTML = [['finance','Финансы'],['orders','Заказы'],['ads','Внутренняя реклама'],['media','WB Media']].map(([key,label]) => {
      const state = sources[key]?.status || 'pending';
      return `<li><span>${label}</span><strong data-state="${esc(state)}">${esc(labels[state] || 'Требует проверки')}</strong></li>`;
    }).join('');
    el('apiCabinetFinance').innerHTML = pairs([
      ['К перечислению за товар',money(f?.forPay)],['Логистика',money(f?.deliveryService)],['Хранение',money(f?.paidStorage)],
      ['Приёмка',money(f?.paidAcceptance)],['Штрафы',money(f?.penalty)],['Прочие удержания',money(f?.deduction)],
      ['Корректировка вознаграждения WB',money(f?.additionalPayment)],['Баллы за отзывы и лояльность, нетто',money(f?.cashbackAmount)],
      ['Комиссия лояльности',money(f?.cashbackCommissionChange)],['Компенсация скидки лояльности',money(f?.cashbackDiscount)],
      ['Реклама в удержаниях (без повторного вычета)',money(f?.advertisingDeductions)],
    ]);
    const ads = sources.ads?.status === 'downloaded' ? sources.ads.totals : null;
    el('apiCabinetAds').innerHTML = ads && Object.keys(ads).length ? pairs(Object.entries(ads).map(([type,data])=>[type,money(data.amount)])) : '<div><dt>Рекламные списания пока не получены</dt><dd>—</dd></div>';
    const missing = cabinet?.missing_costs?.length || 0;
    el('apiCabinetReadiness').innerHTML = [
      f ? missing ? `Себестоимость не заполнена: ${missing} товаров с выкупами.` : 'Себестоимость заполнена для товаров с выкупами.' : 'Себестоимость проверим после загрузки финансов.',
      `Ставка налога: ${number(cabinet?.shop?.tax_rate)}%.`, `Себестоимость выкупов: ${money(cabinet?.cogs)}.`,
      sources.ads?.undated ? `Списания без даты: ${sources.ads.undated}. Не распределены по месяцам.` : 'Реклама распределяется по дате списания, время Москвы.',
    ].map(s=>`<li>${esc(s)}</li>`).join('');
    el('apiCabinetWarning').textContent = cabinet?.complete ? 'Прибыль = к перечислению после удержаний − себестоимость − налог − денежная реклама − операционные расходы − внешнее продвижение. Реклама в удержаниях не вычитается повторно. Бонусы — справочно. Данные API не публикуются в витрине.' : 'Загрузите закрытый месяц. Сервер последовательно получит финансы, заказы и внутреннюю рекламу; данные других магазинов не изменятся.';
  }
  function fillExpenses() {
    const settings = cabinet?.settings || {};
    el('apiOperationalExpenses').value = settings.operational_expenses ?? 0;
    el('apiExternalExpenses').value = settings.external_promotion_expenses ?? 0;
    const media = cabinet?.sources?.media;
    el('apiMediaExpenses').value = settings.media_spend ?? (media?.status === 'confirmed_by_user' ? media.amount : '') ?? '';
    dirty = false;
  }
  async function overview(month = defaultMonth) {
    if (!context?.allowed) return null;
    const current = epoch, ownCache = cache;
    const read = key => {
      if (!ownCache.has(key)) ownCache.set(key, window.WBApi.cabinet('cabinet',key).then(result=>result.cabinet).catch(error=>{ownCache.delete(key);throw error;}));
      return ownCache.get(key);
    };
    if (!historyPromise) historyPromise = window.WBApi.cabinet('cabinet_trend',month).then(result=>result.trend || []).catch(error=>{historyPromise=null;throw error;});
    const [data, trend] = await Promise.all([read(month),historyPromise]);
    if (current !== epoch || !context?.allowed) return null;
    if (ownCache !== cache) return overview(month);
    const [year,m] = month.split('-').map(Number), previousDate = new Date(year,m-2,1);
    const previousKey = `${previousDate.getFullYear()}-${String(previousDate.getMonth()+1).padStart(2,'0')}`;
    const previous = trend.some(p=>`${p.year}-${String(p.month).padStart(2,'0')}`===previousKey) ? await read(previousKey) : null;
    if (current !== epoch || !context?.allowed) return null;
    if (ownCache !== cache) return overview(month);
    return {cabinet:data,trend,previous};
  }
  async function load(action = 'cabinet', refresh = false) {
    if (!context?.allowed || busy) return;
    const current = epoch, ticket = ++requestId, month = el('apiCabinetMonth').value;
    clearTimeout(timer); busy = true; render();
    status(action === 'cabinet_start' ? 'Ставим загрузку в очередь сервера…' : 'Читаем сохранённые данные…');
    try {
      const result = await window.WBApi.cabinet(action,month,refresh);
      if (current !== epoch || ticket !== requestId) return;
      cabinet = result.cabinet; invalidate(); cache.set(month,Promise.resolve(cabinet));
      if (!dirty) fillExpenses();
      const job = cabinet.job;
      if (!job) status('За этот месяц выгрузки нет. Нажмите «Загрузить данные».');
      else if (job.status === 'loading') {
        const stage = {finance:'финансы',orders:'заказы',ads:'внутренняя реклама'}[job.stage] || 'финансы';
        status(`Загружаются ${stage}. Сохранено ${number(job.row_count)} финансовых операций. Можно закрыть страницу.${job.error_message ? ' Последняя попытка: '+job.error_message : ''}`);
      } else if (job.status === 'error') status(job.error_message || 'Загрузка остановлена. Проверьте ключ и повторите.',true);
      else status(`${cabinet.complete ? 'Выгрузка готова' : 'Получена часть источников'} · ${new Date(job.updated_at).toLocaleString('ru-RU')}.`);
      changed();
    } catch (error) { if (current === epoch && ticket === requestId) status(error.message,true); }
    finally {
      if (current === epoch && ticket === requestId) { busy = false; render(); if (reloadQueued) { reloadQueued=false; load(); } else if (cabinet?.job?.status==='loading') timer=setTimeout(()=>load(),15000); }
    }
  }
  async function saveExpenses(month, operational, external, media) {
    if (!context?.allowed) throw new Error('Подключение недоступно');
    const current = epoch;
    const result = await window.WBApi.cabinet('cabinet_settings',month,false,{operational_expenses:operational,external_promotion_expenses:external,media_spend:media});
    if (current !== epoch || !context?.allowed) return null;
    invalidate(); cache.set(month,Promise.resolve(result.cabinet));
    if (month === el('apiCabinetMonth').value) { cabinet=result.cabinet; if(!dirty) fillExpenses(); render(); }
    changed(); return result.cabinet;
  }
  async function saveOverviewExpenses(month, operational, external) {
    const snapshot = await overview(month);
    if (!snapshot?.cabinet?.complete) throw new Error('Сначала загрузите месяц в настройках');
    const data = snapshot.cabinet, media = data.sources?.media;
    return saveExpenses(month,operational,external,data.settings?.media_spend ?? (media?.status==='confirmed_by_user' || media?.status==='downloaded' ? media.amount : null));
  }
  function setContext(next) {
    if (context?.shopId === next.shopId && context?.allowed === next.allowed) return;
    context = {...next}; ++epoch; ++requestId; clearTimeout(timer); busy=false; cabinet=null; dirty=false; reloadQueued=false; invalidate();
    el('secApiCabinet').hidden = !next.allowed;
    el('apiCabinetMonth').value = defaultMonth;
    el('apiExpensesStatus').textContent = ''; status(''); fillExpenses(); render();
    if (next.allowed) load();
  }
  el('apiCabinetMonth').addEventListener('change',()=>{cabinet=null;dirty=false;fillExpenses();el('apiExpensesStatus').textContent='';render();load();});
  el('apiCabinetSync').addEventListener('click',()=>load(cabinet?.complete ? 'cabinet' : 'cabinet_start'));
  el('apiCabinetRefresh').addEventListener('click',()=>load('cabinet_start',true));
  for (const id of ['apiOperationalExpenses','apiExternalExpenses','apiMediaExpenses']) el(id).addEventListener('input',()=>{dirty=true;el('apiSaveExpenses').disabled=busy || !context?.allowed;});
  el('apiCabinetExpensesForm').addEventListener('submit',async event=>{
    event.preventDefault(); if (!context?.allowed || busy || !dirty) return;
    const current=epoch, month=el('apiCabinetMonth').value;
    clearTimeout(timer);busy=true;render();
    try {
      const result=await saveExpenses(month,el('apiOperationalExpenses').value,el('apiExternalExpenses').value,el('apiMediaExpenses').value || null);
      if(current!==epoch || !result)return;
      cabinet=result;fillExpenses();el('apiExpensesStatus').textContent='Расходы сохранены';el('apiExpensesStatus').dataset.error='false';
    } catch(error) {if(current===epoch){el('apiExpensesStatus').textContent=error.message;el('apiExpensesStatus').dataset.error='true';}}
    finally {if(current===epoch){busy=false;render();if(reloadQueued){reloadQueued=false;load();}else if(cabinet?.job?.status==='loading')timer=setTimeout(()=>load(),15000);}}
  });
  window.WBApiCabinet = {setContext,overview,saveOverviewExpenses,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},reload:()=>{if(!context?.allowed)return;invalidate();if(busy)reloadQueued=true;else load();}};
})();
