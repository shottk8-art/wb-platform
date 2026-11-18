(function(root){
 'use strict';
 const sections=[['overview','Обзор','Продажи, прибыль, расходы и динамика магазина.'],['daily','Углублённая аналитика','Ежедневная прибыль и юнит-экономика WB и Ozon.'],['stocks','Остатки','Запасы WB, склады и уведомления о пополнении.'],['reports','Отчёты','Загрузка файлов и управление журналом загрузок.'],['costs','Себестоимость','Просмотр, импорт и редактирование закупочных цен.'],['team','Команда','Участники и приглашения в доступные магазины.'],['settings','Настройки','Подключение API, налог и настройки своего магазина.'],['account','Учётная запись','Профиль пользователя и оформление платформы.'],['ai','ИИ-анализ в Обзоре','Анализ результатов. При включении также открывается Обзор.'],['promocodes','Промокоды TOPLASH','Только статистика промокодов, без остальных данных TOPLASH.']];
 const label=u=>u.full_name||(u.telegram_username?'@'+u.telegram_username:u.email)||'Пользователь';
 const initials=u=>Array.from(label(u).replace(/^@/,'')).slice(0,2).join('').toLocaleUpperCase('ru-RU');
 function mount({users,actorId}){
  const el=id=>root.document.getElementById(id),form=el('accessForm');if(!form)return;
  let selected=null,saved=null,draft=null,revision=0,busy=false,loading=false;
  const dirty=()=>!!saved&&sections.some(([key])=>draft[key]!==saved.sections[key]);
  const status=(text,error=false)=>{el('accessStatus').textContent=text;el('accessStatus').dataset.error=String(error);};
  function controls(){const locked=saved?.is_admin===true;el('accessFields').disabled=busy||loading||!draft||locked;el('accessSave').disabled=busy||loading||!dirty()||locked;el('accessSave').textContent=busy?'Сохраняем…':'Сохранить доступы';el('accessCancel').disabled=busy||loading||!dirty();el('accessSearch').disabled=busy;for(const button of el('accessUsers').querySelectorAll('button'))button.disabled=busy;form.setAttribute('aria-busy',String(busy||loading));el('accessCount').textContent=draft?`${sections.filter(([k])=>draft[k]).length} из ${sections.length} разделов`:'';}
  function switches(){for(const input of el('accessSections').querySelectorAll('input'))input.checked=draft?.[input.dataset.section]===true;controls();}
  function list(){const query=el('accessSearch').value.trim().toLocaleLowerCase('ru-RU');const matches=users.filter(u=>(label(u)+' '+(u.telegram_username||'')+' '+(u.email||'')).toLocaleLowerCase('ru-RU').includes(query));el('accessUsers').replaceChildren();el('accessNoUsers').hidden=matches.length>0;
   for(const user of matches){const button=root.document.createElement('button');button.type='button';button.className='access-user';button.setAttribute('aria-pressed',String(user.id===selected?.id));const avatar=root.document.createElement('span');avatar.className='access-avatar';avatar.setAttribute('aria-hidden','true');avatar.textContent=initials(user);const text=root.document.createElement('span'),name=root.document.createElement('strong'),contact=root.document.createElement('small');name.textContent=label(user);contact.textContent=user.id===actorId?'Администратор · вы':user.telegram_username?'@'+user.telegram_username:user.email||'Без ника Telegram';text.append(name,contact);button.append(avatar,text);button.addEventListener('click',()=>choose(user));el('accessUsers').append(button);}
   controls();
  }
  async function choose(user){if(busy)return;if(dirty()&&!root.confirm('Не сохранять изменения для текущего пользователя?'))return;
   const ticket=++revision;selected=user;saved=draft=null;loading=true;el('accessRetry').hidden=true;el('accessLocked').hidden=true;el('accessUserName').textContent=label(user);el('accessUserContact').textContent=user.telegram_username?'@'+user.telegram_username:user.email||'';el('accessAvatar').textContent=initials(user);status('Проверяем текущие доступы…');switches();list();
   try{const result=await root.WBAdmin.getSectionAccess(user.id);if(ticket!==revision)return;if(result?.user_id!==user.id||sections.some(([key])=>typeof result.sections?.[key]!=='boolean'))throw Error('Сервер не вернул список доступов');saved=result;draft={...result.sections};el('accessLocked').hidden=!result.is_admin;status(result.is_admin?'Полный доступ администратора':'Выберите доступные разделы и сохраните изменения.');}
   catch(error){if(ticket!==revision)return;status(error.message||'Не удалось загрузить доступы',true);el('accessRetry').hidden=false;}
   finally{if(ticket===revision){loading=false;switches();}}
  }
  el('accessSections').replaceChildren();
  for(const [key,title,description] of sections){const row=root.document.createElement('label');row.className='access-permission';const text=root.document.createElement('span'),strong=root.document.createElement('strong'),hint=root.document.createElement('small');strong.textContent=title;hint.textContent=description;text.append(strong,hint);const input=root.document.createElement('input');input.type='checkbox';input.dataset.section=key;input.setAttribute('role','switch');input.setAttribute('aria-label',title);row.append(text,input);el('accessSections').append(row);input.addEventListener('change',()=>{if(!draft)return;draft[key]=input.checked;if(key==='ai'&&input.checked)draft.overview=true;if(key==='overview'&&!input.checked)draft.ai=false;status(dirty()?'Есть несохранённые изменения':'Изменений нет');switches();});}
  form.addEventListener('submit',async event=>{event.preventDefault();if(!dirty()||busy||loading||saved.is_admin)return;const user=selected,ticket=revision,submitted={...draft};busy=true;el('accessRetry').hidden=true;status('Сохраняем доступы…');controls();
   try{const result=await root.WBAdmin.saveSectionAccess(user.id,submitted);if(ticket!==revision)return;if(result?.user_id!==user.id||sections.some(([key])=>typeof result.sections?.[key]!=='boolean'))throw Error('Не удалось подтвердить сохранение');saved=result;draft={...result.sections};status('Доступы сохранены.');}
   catch(error){if(ticket===revision)status(error.message||'Не удалось сохранить. Попробуйте ещё раз.',true);}
   finally{if(ticket===revision){busy=false;switches();}}
  });
  el('accessSearch').addEventListener('input',list);el('accessCancel').addEventListener('click',()=>{if(!saved||busy)return;draft={...saved.sections};switches();status('Изменения отменены');});el('accessRetry').addEventListener('click',()=>{if(selected)choose(selected);});
  root.supabaseClient?.auth.onAuthStateChange((event,session)=>{if(event!=='INITIAL_SESSION'&&session?.user?.id!==actorId){++revision;busy=false;loading=false;selected=saved=draft=null;el('accessUsers').replaceChildren();el('accessSections').replaceChildren();controls();}});
  list();if(users.length)choose(users.find(u=>u.id!==actorId)||users[0]);else status('Пользователи появятся здесь после первого входа через Telegram.');
 }
 root.WBAdminAccess={mount};
})(window);
