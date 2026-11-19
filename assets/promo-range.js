// Presentation only: commit ISO calendar dates to the existing promo form.
(function(root){
  'use strict';
  const DAY=86400000,pad=n=>String(n).padStart(2,'0');
  const iso=d=>d.toISOString().slice(0,10);
  function valid(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;const d=new Date(value+'T00:00:00Z');return Number.isFinite(+d)&&iso(d)===value;}
  function parse(value){const m=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim());const date=m?`${m[3]}-${m[2]}-${m[1]}`:'';return valid(date)?date:null;}
  const formatInput=value=>value.replace(/\D/g,'').slice(0,8).replace(/^(\d{2})(\d)/,'$1.$2').replace(/^(\d{2}\.\d{2})(\d)/,'$1.$2');
  const display=value=>valid(value)?value.split('-').reverse().join('.'):'';
  const serial=value=>+value.slice(0,4)*12+ +value.slice(5,7)-1;
  const first=n=>iso(new Date(Date.UTC(Math.floor(n/12),n%12,1)));
  const last=n=>iso(new Date(Date.UTC(Math.floor((n+1)/12),(n+1)%12,0)));
  const add=(value,days)=>iso(new Date(+new Date(value+'T00:00:00Z')+days*DAY));
  const clamp=(value,min,max)=>value<min?min:value>max?max:value;
  const length=(from,to)=>Math.round((+new Date(to+'T00:00:00Z')- +new Date(from+'T00:00:00Z'))/DAY)+1;
  function error(from,to,min,max){
    if(!valid(from)||!valid(to))return 'Введите обе даты в формате ДД.ММ.ГГГГ';
    if(from>to)return 'Начало периода должно быть не позже окончания';
    if(from<min||to>max)return `Доступны даты с ${display(min)} по ${display(max)}`;
    return '';
  }
  function preset(kind,min,max){
    let from,to=max;
    if(kind==='7')from=add(max,-6);
    else if(kind==='30')from=add(max,-29);
    else if(kind==='current')from=first(serial(max));
    else if(kind==='previous'){from=first(serial(max)-1);to=last(serial(max)-1);}
    else throw new Error('Unknown period preset');
    return {from:clamp(from,min,max),to:clamp(to,min,max)};
  }
  const math={valid,parse,formatInput,display,serial,first,last,add,length,error,preset};
  if(typeof module==='object'&&module.exports)module.exports=math;
  if(!root.document)return;
  const doc=root.document;
  function create(options){
  const prefix=options.prefix||'promoRange',el=id=>doc.getElementById(id.replace(/^promoRange/,prefix));
  const {from,to,trigger}=options;
  if(!from||!to||!trigger)return null;
  const getPreset=kind=>preset(kind,from.min,to.max);
  const longDate=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
  const monthName=n=>new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(first(n)+'T00:00:00Z')).replace(/ г\.$/,'');
  const arrow=direction=>`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="${direction==='left'?'m14 6-6 6 6 6':'m10 6 6 6-6 6'}"/></svg>`;
  const pop=doc.createElement('div');pop.id=prefix+'Popover';pop.className='promo-range-popover';
  pop.setAttribute('popover','auto');pop.setAttribute('role','dialog');pop.setAttribute('aria-labelledby',prefix+'Title');
  pop.innerHTML=`<div class="promo-range-head"><h2 id="promoRangeTitle">Выберите период</h2><button type="button" id="promoRangeClose" class="promo-range-icon" aria-label="Закрыть выбор периода"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></div>
    <div class="promo-range-presets" aria-label="Быстрый выбор периода"><button type="button" data-preset="7">Последние 7 дней</button><button type="button" data-preset="30">Последние 30 дней</button><button type="button" data-preset="current">Текущий месяц</button><button type="button" data-preset="previous">Прошлый месяц</button></div>
    <div class="promo-range-fields"><label>Начало периода<input id="promoRangeFrom" type="text" inputmode="numeric" placeholder="ДД.ММ.ГГГГ" maxlength="10" autocomplete="off" aria-describedby="promoRangeHint"></label><label>Конец периода<input id="promoRangeTo" type="text" inputmode="numeric" placeholder="ДД.ММ.ГГГГ" maxlength="10" autocomplete="off" aria-describedby="promoRangeHint"></label></div>
    <div class="promo-range-nav"><button type="button" id="promoRangePrev" class="promo-range-icon" aria-label="Предыдущий месяц">${arrow('left')}</button><label class="promo-visually-hidden" for="promoRangeMonth">Месяц календаря</label><select id="promoRangeMonth" data-native-control></select><button type="button" id="promoRangeNext" class="promo-range-icon" aria-label="Следующий месяц">${arrow('right')}</button></div>
    <div id="promoRangeCalendars" class="promo-range-calendars"></div><p id="promoRangeHint" class="promo-range-hint" role="status" aria-live="polite"></p>
    <div class="promo-range-footer"><span id="promoRangeCount"></span><button type="button" id="promoRangeCancel">Отмена</button><button type="button" id="promoRangeApply" class="primary">Применить</button></div>`;
  pop.innerHTML=pop.innerHTML.replaceAll('promoRange',prefix);
  doc.body.append(pop);
  const inputFrom=el('promoRangeFrom'),inputTo=el('promoRangeTo'),calendars=el('promoRangeCalendars');
  const mobile=root.matchMedia('(max-width: 600px)'),native=typeof pop.showPopover==='function';
  let opened=false,draftFrom='',draftTo='',view=0,choosingEnd=false,hover='',focusDay='',frame=null;
  const bounds=()=>({min:from.min,max:to.max});
  const validate=(a,b)=>{const {min,max}=bounds();return error(a,b,min,max)||options.validate?.(a,b)||'';};
  const viewLimit=()=>Math.max(serial(from.min),serial(to.max)-(mobile.matches?0:1));
  function position(){
    if(!opened)return;const r=trigger.getBoundingClientRect();
    if(mobile.matches){Object.assign(pop.style,{left:'12px',right:'12px',top:'auto',bottom:'max(12px, env(safe-area-inset-bottom))',width:'auto',maxHeight:'calc(100dvh - 24px)'});return;}
    const width=Math.min(640,root.innerWidth-24),height=Math.min(pop.scrollHeight+2,root.innerHeight-24);
    const below=Math.max(0,root.innerHeight-r.bottom-20),above=Math.max(0,r.top-20),useBelow=below>=height||below>=above;
    const fits=below>=height||above>=height,space=fits?(useBelow?below:above):root.innerHeight-24;
    const top=fits?(useBelow?r.bottom+8:Math.max(12,r.top-Math.min(height,space)-8)):Math.max(12,Math.min(r.bottom+8,root.innerHeight-height-12));
    Object.assign(pop.style,{width:width+'px',left:Math.max(12,Math.min(r.left,root.innerWidth-width-12))+'px',right:'auto',top:top+'px',bottom:'auto',maxHeight:Math.max(180,space)+'px'});
  }
  function schedulePosition(){if(frame!=null)return;frame=root.requestAnimationFrame(()=>{frame=null;position();});}
  function updateHint(message){
    const problem=validate(draftFrom,draftTo),hint=el('promoRangeHint');
    hint.textContent=message||(choosingEnd?'Теперь выберите конец периода':problem||'Выберите начало и конец на календаре или введите даты');
    hint.dataset.error=String(!!problem&&!choosingEnd&&inputFrom.value.length===10&&inputTo.value.length===10);
    inputFrom.setAttribute('aria-invalid',String(inputFrom.value.length===10&&(!valid(draftFrom)||draftFrom<from.min||draftFrom>to.max)));
    inputTo.setAttribute('aria-invalid',String(inputTo.value.length===10&&(!valid(draftTo)||draftTo<from.min||draftTo>to.max||valid(draftFrom)&&draftFrom>draftTo)));
    pop.querySelectorAll('[data-preset]').forEach(button=>{const p=getPreset(button.dataset.preset);button.setAttribute('aria-pressed',String(p.from===draftFrom&&p.to===draftTo));});
    el('promoRangeApply').disabled=!!problem;
    el('promoRangeCount').textContent=problem?'':`${length(draftFrom,draftTo)} ${new Intl.PluralRules('ru-RU').select(length(draftFrom,draftTo))==='one'?'день':new Intl.PluralRules('ru-RU').select(length(draftFrom,draftTo))==='few'?'дня':'дней'}`;
  }
  function paint(){
    let a=draftFrom,b=draftTo;
    if(choosingEnd&&hover){a=hover<draftFrom?hover:draftFrom;b=hover<draftFrom?draftFrom:hover;}
    calendars.querySelectorAll('[data-day]').forEach(button=>{const d=button.dataset.day;
      button.classList.toggle('is-start',d===a);button.classList.toggle('is-end',d===b);button.classList.toggle('is-between',!!a&&!!b&&d>a&&d<b);
      button.parentElement.setAttribute('aria-selected',String(!!a&&(d===a||!!b&&d>=a&&d<=b)));
    });
  }
  function render(){
    const {min,max}=bounds();view=Math.max(serial(min),Math.min(viewLimit(),view));
    const options=[];for(let m=serial(min);m<=viewLimit();m++)options.push(`<option value="${m}"${m===view?' selected':''}>${monthName(m)}</option>`);
    el('promoRangeMonth').innerHTML=options.join('');el('promoRangePrev').disabled=view<=serial(min);el('promoRangeNext').disabled=view>=viewLimit();
    const count=mobile.matches?1:2;let html='';
    for(let i=0;i<count;i++){
      const m=view+i,start=first(m),days=+last(m).slice(-2),offset=(new Date(start+'T00:00:00Z').getUTCDay()+6)%7;
      html+=`<table role="grid" aria-label="${monthName(m)}"><caption>${monthName(m)}</caption><thead><tr>${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(day=>`<th scope="col">${day}</th>`).join('')}</tr></thead><tbody>`;
      for(let cell=0;cell<42;cell++){
        if(cell%7===0)html+='<tr>';const day=cell-offset+1;
        if(day<1||day>days)html+='<td class="promo-range-blank"></td>';
        else {const d=start.slice(0,8)+pad(day);html+=`<td aria-selected="false"><button type="button" class="promo-range-day" data-day="${d}" tabindex="${d===focusDay?'0':'-1'}" aria-label="${longDate.format(new Date(d+'T00:00:00Z'))}"${d===max?' aria-current="date"':''}${d<min||d>max||options.isDateAllowed?.(d)===false?' disabled':''}>${day}</button></td>`;}
        if(cell%7===6)html+='</tr>';
      }html+='</tbody></table>';
    }
    calendars.innerHTML=html;
    if(!calendars.querySelector('[tabindex="0"]')){const firstEnabled=calendars.querySelector('[data-day]:not(:disabled)');if(firstEnabled)firstEnabled.tabIndex=0;}
    inputFrom.value=display(draftFrom);inputTo.value=display(draftTo);paint();updateHint();schedulePosition();
  }
  function sync(){
    const label=valid(from.value)&&valid(to.value)?`${display(from.value)} — ${display(to.value)}`:'Выбрать даты';
    el('promoRangeValue').textContent=label;trigger.title=label;
    trigger.setAttribute('aria-label','Период: '+label);
    if(opened&&trigger.disabled)close(false);
  }
  function open(){
    if(trigger.disabled)return;if(opened){close(true);return;}
    draftFrom=from.value;draftTo=to.value;choosingEnd=false;hover='';focusDay=draftFrom;view=serial(draftFrom);opened=true;render();
    trigger.setAttribute('aria-expanded','true');
    if(native)pop.showPopover({source:trigger});else pop.dataset.fallbackOpen='true';
    position();el('promoRangeClose').focus({preventScroll:true});pop.scrollTop=0;
  }
  function close(restoreFocus){
    if(!opened)return;opened=false;trigger.setAttribute('aria-expanded','false');
    if(native&&pop.matches(':popover-open'))pop.hidePopover();delete pop.dataset.fallbackOpen;
    if(restoreFocus&&!trigger.disabled)trigger.focus({preventScroll:true});
  }
  function apply(){
    const a=parse(inputFrom.value),b=parse(inputTo.value),problem=validate(a,b);
    if(problem){updateHint(problem);return;}
    from.value=a;to.value=b;sync();close(true);options.onApply?.(a,b);
  }
  trigger.addEventListener('click',open);
  pop.addEventListener('toggle',event=>{if(event.newState==='closed'){opened=false;trigger.setAttribute('aria-expanded','false');}});
  el('promoRangeClose').addEventListener('click',()=>close(true));el('promoRangeCancel').addEventListener('click',()=>close(true));el('promoRangeApply').addEventListener('click',apply);
  pop.addEventListener('click',event=>{
    const day=event.target.closest('[data-day]'),quick=event.target.closest('[data-preset]');
    if(quick){const p=getPreset(quick.dataset.preset);draftFrom=p.from;draftTo=p.to;choosingEnd=false;hover='';focusDay=p.from;view=serial(p.from);render();return;}
    if(!day||day.disabled)return;focusDay=day.dataset.day;hover='';
    if(!choosingEnd){draftFrom=focusDay;draftTo='';choosingEnd=true;}
    else {draftTo=focusDay;if(draftTo<draftFrom)[draftFrom,draftTo]=[draftTo,draftFrom];choosingEnd=false;}
    render();calendars.querySelector(`[data-day="${focusDay}"]`)?.focus({preventScroll:true});
  });
  for(const input of [inputFrom,inputTo])input.addEventListener('input',()=>{
    const digitsBefore=input.value.slice(0,input.selectionStart).replace(/\D/g,'').length,formatted=formatInput(input.value);
    if(input.value!==formatted){input.value=formatted;let caret=0,digits=0;while(caret<formatted.length&&digits<digitsBefore){if(/\d/.test(formatted[caret]))digits++;caret++;}input.setSelectionRange(caret,caret);}
    draftFrom=parse(inputFrom.value)||'';draftTo=parse(inputTo.value)||'';choosingEnd=false;hover='';paint();updateHint();
  });
  pop.addEventListener('mouseover',event=>{const button=event.target.closest('[data-day]');if(choosingEnd&&button&&!button.disabled){hover=button.dataset.day;paint();}});
  calendars.addEventListener('mouseleave',()=>{hover='';paint();});
  function moveMonth(delta){view+=delta;hover='';render();}
  el('promoRangePrev').addEventListener('click',()=>moveMonth(-1));el('promoRangeNext').addEventListener('click',()=>moveMonth(1));
  el('promoRangeMonth').addEventListener('change',event=>{view=Number(event.target.value);hover='';render();});
  pop.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();close(true);return;}
    if(event.key==='Enter'&&(event.target===inputFrom||event.target===inputTo)){event.preventDefault();apply();return;}
    const button=event.target.closest('[data-day]');if(!button)return;
    const d=button.dataset.day,weekday=(new Date(d+'T00:00:00Z').getUTCDay()+6)%7;
    const step={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:-weekday,End:6-weekday}[event.key];let target;
    if(step!==undefined)target=add(d,step);
    else if(event.key==='PageUp'||event.key==='PageDown'){const m=serial(d)+(event.key==='PageUp'?-1:1);target=first(m).slice(0,8)+pad(Math.min(+d.slice(-2),+last(m).slice(-2)));}
    else return;
    event.preventDefault();focusDay=clamp(target,from.min,to.max);
    if(serial(focusDay)<view)view=serial(focusDay);if(serial(focusDay)>view+(mobile.matches?0:1))view=serial(focusDay)-(mobile.matches?0:1);
    if(choosingEnd)hover=focusDay;render();calendars.querySelector(`[data-day="${focusDay}"]`)?.focus({preventScroll:true});
  });
  doc.addEventListener('pointerdown',event=>{if(opened&&!native&&!pop.contains(event.target)&&!trigger.contains(event.target))close(false);});
  doc.addEventListener('focusin',event=>{if(opened&&!pop.contains(event.target)&&event.target!==trigger)close(false);});
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden)close(false);});
  root.addEventListener('resize',()=>{if(opened){render();position();}});
  root.addEventListener('scroll',event=>{if(opened&&!pop.contains(event.target))schedulePosition();},true);
  mobile.addEventListener?.('change',()=>{if(opened){render();position();}});
  sync();return {sync,close,validate};
  }
  root.WBDateRange={...math,create};
  const form=doc.getElementById('promoPeriodForm'),trigger=doc.getElementById('promoRangeToggle');
  if(form&&trigger)root.WBPromoRange=create({from:doc.getElementById('promoFrom'),to:doc.getElementById('promoTo'),trigger,onApply:()=>form.requestSubmit()});
})(typeof window==='undefined'?globalThis:window);
