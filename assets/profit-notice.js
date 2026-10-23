// Explain existing unknown profit values; never calculate or replace money.
(function(root){
  'use strict';
  const key=value=>String(value??'').trim().toLowerCase();
  function articles(values){
    const unique=new Map();
    for(const value of values||[]){if(typeof value!=='string'||!key(value))continue;if(!unique.has(key(value)))unique.set(key(value),value.trim());}
    return [...unique.values()];
  }
  function describe(d){
    if(!d||Number.isFinite(d.netProfit))return null;
    const missing=articles(d.missingCosts),reasons=new Set(d.missing||[]);
    if(!missing.length&&!reasons.size&&d.rep?.sales_amount==null)return null;
    const messages=[];
    if(missing.length)messages.push(`Не заполнена себестоимость ${missing.length} ${missing.length%10===1&&missing.length%100!==11?'товара':'товаров'}. Укажите закупочные цены, чтобы рассчитать прибыль.`);
    else if(reasons.has('Не заполнена себестоимость'))messages.push('Не заполнена себестоимость товаров с выкупами. Укажите закупочные цены в разделе «Себестоимость».');
    if(reasons.has('Расходы WB Медиа ещё не получены из API'))messages.push('Расходы WB Медиа ещё не получены. Дождитесь загрузки или проверьте подключение в настройках.');
    else if(reasons.has('Не все источники загружены'))messages.push('Не все данные WB загружены. Статус и возможность повторить загрузку доступны в настройках.');
    if(reasons.has('Есть неизвестные типы или даты рекламных списаний'))messages.push('У части рекламных списаний не определены тип или дата. Проверьте источники в настройках.');
    if(!messages.length)messages.push('Для расчёта чистой прибыли не хватает данных. Проверьте загрузку и источники в настройках.');
    const costs=missing.length>0||reasons.has('Не заполнена себестоимость');
    return {title:'Чистая прибыль не рассчитана',message:messages.join(' '),articles:missing,action:costs?'costs':'settings',actionLabel:costs?'Заполнить себестоимость':'Проверить загрузку',short:costs?'Не заполнена себестоимость':'Не хватает данных для расчёта'};
  }
  function create({root,title,body,action,onAction}){
    let current=null;
    function reset(){current=null;root.hidden=true;title.textContent='';body.textContent='';action.textContent='';}
    action.addEventListener('click',()=>{if(current)onAction({...current,articles:[...current.articles]});});
    reset();
    return {reset,update(d){current=describe(d);if(!current){reset();return;}title.textContent=current.title;body.textContent=current.message;action.textContent=current.actionLabel;root.hidden=false;}};
  }
  const api={describe,create};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.WBProfitNotice=api;
})(typeof window==='object'?window:globalThis);
