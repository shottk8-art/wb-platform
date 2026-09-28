/* ---------- игра по сети, общий модуль dvoeplay ---------- */
/* Один файл на все игры серии. Подключается строкой <script src="net.js"></script>
   перед скриптом самой игры.

   Что берёт на себя модуль: комната и код, лобби с приглашением по ссылке,
   опрос сервера, доставка ходов в обе стороны, согласованный реванш,
   предупреждение об обрыве связи и общий генератор случайных чисел.

   Чего модуль НЕ знает: правил игры. Очерёдность считает сама игра и
   сообщает её в NET.send(ход, комуДальше) — потому что в «Точках»,
   «Мемо-дуэли» и «Ящике» ход часто остаётся за тем же игроком.

   Разметку и стили модуль вставляет сам: у игр серии шторки устроены
   по-разному (где-то body.open и .backdrop, где-то scrim и .on), и
   опираться на них нельзя. Зато CSS-переменные у всех общие — на них
   всё и построено, поэтому лобби выглядит родным в любой игре.

   Партия синхронизируется СПИСКОМ ХОДОВ: игры детерминированные, так что
   достаточно передать сам ход, а состояние поля каждый считает у себя.
   Там, где нужна общая случайность (колода, загаданное слово, броски
   кубиков), используется NET.rng — генератор от общего зерна комнаты,
   одинаковый у обоих и свой на каждый раунд.

   Режим без очереди (free: true в NET.init, с 26.09.2026 — «Доббль»).
   Игры на скорость ходят одновременно, и спрашивать «чей ход» там нельзя.
   Комната заводится с пометкой free: сервер принимает ход от любого из
   двоих и кладёт его в общий список в порядке прихода. Свой ход в этом
   режиме НЕ считается сразу и не разыгрывается у себя — он возвращается
   с сервера вместе с чужими, на своём месте в списке. Только так оба
   телефона видят одинаковый порядок заявок, и спор «кто первый» решается
   одинаково у обоих. Остальные игры этот режим не затрагивает. */

var NET = (function(){
  "use strict";

  var opt = null;                 /* настройки от игры */
  var timer = 0, gen = 0;
  var over = false;               /* партия доиграна, ждём реванша */
  /* Очередь своих ходов. Ход лежит здесь, пока сервер его не подтвердил:
     один обрыв связи — и без очереди ход остался бы только на своём
     телефоне, а партия разъехалась бы навсегда. */
  var outbox = [], sending = false;
  var midTag = Math.random().toString(36).slice(2, 8), midNo = 0;
  var pollBad = 0, sendBad = 0, lost = false;
  var mark = '', markAt = 0;      /* по чём видно, что на сервере что-то поменялось */
  /* Пришедшие ходы соперника. Одним ответом их может прийти сразу
     несколько — там, где ход остаётся за тем же игроком, или когда связь
     на секунду пропала. Вываливать их в игру разом нельзя: у неё на каждый
     ход своя анимация и свои паузы, и следующий ход, пришедший посреди
     предыдущего, ломает поле. Поэтому ходы ждут здесь и уходят в игру по
     одному, как только она готова их принять. */
  var queue = [], feeder = 0;
  /* Сколько ходов раунда мы уже знаем: свои отправленные плюс принятые от
     сервера. Считает их сам модуль, и только вперёд. Раньше это число брали
     у игры (`applied()`) — и стоило ей один ход не принять, как оно ехало
     назад: сервер честно слал тот же хвост снова и снова, а на экране ходы
     повторялись сами собой без конца. В режиме free свои ходы сюда не идут,
     пока не вернутся с сервера. */
  var known = 0;
  var askew = 0;                  /* сколько опросов подряд счёт игры не сходится с нашим */
  var fixes = 0;                  /* сколько раз за раунд уже лечили поле пересборкой */
  var syncAt = 0;                 /* когда последний раз пересобирали раунд */
  var focusAt = 0;               /* отложенный подъём клавиатуры в поле кода */
  var againLabel = '';            /* родная подпись кнопки «играть снова» */
  var el = {};

  var api_ = {
    on: false, live: false, turn: 0,
    code: '', token: '', seat: 0, round: 0, seed: 0,
    rng: null, oppOnline: false, oppLeft: false,
    myName: '', oppName: ''
  };

  /* режим без очереди: ходят оба сразу, порядок решает сервер */
  function free(){ return !!(opt && opt.free); }

  /* Своё имя лежит в общей памяти приложения. Читаем её напрямую, а не
     через DP: блок DP объявлен внутри замыкания игры и снаружи не виден.
     Ключ и правила обрезки те же, что в DP — если меняются, менять тут тоже. */
  var STORE = 'dvoeplay:v1';
  function clipName(v){
    return String(v == null ? '' : v).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').slice(0, 12);
  }
  function myName(){
    try {
      var d = JSON.parse(localStorage.getItem(STORE));
      return clipName(d && d.names && d.names.me);
    } catch(e){ return ''; }
  }
  function saveMyName(v){
    try {
      var d = JSON.parse(localStorage.getItem(STORE));
      if (!d || typeof d !== 'object') d = { v: 1, games: {} };
      if (!d.names) d.names = { me: '', friend: '' };
      d.names.me = clipName(v);
      localStorage.setItem(STORE, JSON.stringify(d));
    } catch(e){}
  }

  /* ---------- общая случайность ---------- */
  /* mulberry32: короткий и равномерный, одинаковый у обоих игроков */
  function mulberry32(a){
    return function(){
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function seedRound(){ api_.rng = mulberry32((api_.seed | 0) + api_.round * 7919); }

  /* ---------- стили ---------- */
  var CSS = [
    '.np-back{position:fixed;inset:0;z-index:40;background:rgba(0,0,0,.3);opacity:0;pointer-events:none;',
      'transition:opacity .34s ease;-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}',
    '.np-open .np-back{opacity:1;pointer-events:auto}',
    '.np-sheet{position:fixed;left:0;right:0;bottom:0;z-index:41;max-width:520px;margin:0 auto;',
      'background:var(--surface);color:var(--label);border-radius:26px 26px 0 0;',
      'padding:10px 20px calc(22px + env(safe-area-inset-bottom));text-align:center;',
      'box-shadow:0 -8px 40px rgba(0,0,0,.18);transform:translateY(calc(100% + 60px));',   /* с тенью за край, иначе она полосой лежит по низу экрана */
      'transition:transform .5s var(--spring,cubic-bezier(.32,.72,0,1));',
      'font:400 17px/1.3 -apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",system-ui,sans-serif}',
    '.np-open .np-sheet{transform:none}',
    /* пока в лобби набирают имя или код, шторка стоит у верхнего края экрана:
       клавиатура телефона ложится поверх низа, а верх она не достаёт */
    '.np-open .np-sheet.np-typing{top:calc(env(safe-area-inset-top) + 8px);bottom:auto;left:8px;right:8px;',
      'border-radius:26px;padding-top:16px;padding-bottom:16px}',
    '.np-typing .np-grab,.np-typing .np-sub{display:none}',
    '.np-grab{width:36px;height:5px;border-radius:3px;background:var(--fill);margin:0 auto 18px}',
    '.np-sheet h2{font-size:24px;font-weight:700;letter-spacing:-.45px;margin:0 0 5px}',
    '.np-sub{font-size:15px;color:var(--label2);margin:0 0 22px;letter-spacing:-.1px}',
    '.np-pane[hidden]{display:none}',
    '.np-code{font:700 42px/1 -apple-system,system-ui,sans-serif;letter-spacing:10px;text-indent:10px;',
      'font-variant-numeric:tabular-nums;margin:0 0 18px}',
    '.np-in{display:block;width:100%;margin:0 0 16px;padding:15px 0;border:0;border-radius:14px;',
      '-webkit-appearance:none;appearance:none;',
      'background:var(--fill);color:var(--label);text-align:center;text-indent:10px;outline:none;',
      'font:700 32px/1 -apple-system,system-ui,sans-serif;letter-spacing:10px;',
      'font-variant-numeric:tabular-nums;-webkit-user-select:text;user-select:text}',
    '.np-in::placeholder{color:var(--label3);letter-spacing:10px}',
    '.np-name{display:block;width:100%;margin:0 0 12px;padding:14px 16px;border:0;border-radius:14px;',
      '-webkit-appearance:none;appearance:none;',
      'background:var(--fill);color:var(--label);text-align:center;outline:none;',
      'font:500 17px/1 -apple-system,system-ui,sans-serif;letter-spacing:-.2px;',
      '-webkit-user-select:text;user-select:text}',
    '.np-name::placeholder{color:var(--label3);font-weight:400}',
    '.np-name:focus{box-shadow:0 0 0 3px color-mix(in srgb,var(--tint) 40%,transparent)}',
    '.np-in:focus{box-shadow:0 0 0 3px color-mix(in srgb,var(--tint) 40%,transparent)}',
    '.np-wait{display:flex;align-items:center;justify-content:center;gap:7px;margin:0 0 18px;',
      'font-size:14px;color:var(--label2);letter-spacing:-.1px}',
    '.np-dot{display:inline-flex;gap:3px}',
    '.np-dot i{width:4px;height:4px;border-radius:50%;background:var(--label2);opacity:.25;animation:np-blink 1.1s infinite}',
    '.np-dot i:nth-child(2){animation-delay:.15s}.np-dot i:nth-child(3){animation-delay:.3s}',
    '@keyframes np-blink{0%,60%,100%{opacity:.22}30%{opacity:.9}}',
    '.np-go{display:block;width:100%;border:0;border-radius:14px;background:var(--tint);color:#fff;cursor:pointer;',
      'font:600 17px/1 -apple-system,system-ui,sans-serif;letter-spacing:-.2px;padding:16px;',
      'transition:transform .18s var(--spring,ease),opacity .18s ease}',
    '.np-go:active{transform:scale(.97);opacity:.85}',
    '.np-go[disabled]{opacity:.5;transform:none;cursor:default}',
    '.np-alt{border:0;background:none;color:var(--tint);cursor:pointer;padding:16px 8px 2px;',
      'font:400 17px/1 -apple-system,system-ui,sans-serif}',
    '.np-msg{margin:14px 0 0;font-size:14px;line-height:1.35;color:var(--red-b,#E7362B);letter-spacing:-.1px;word-break:break-word}',
    '.np-msg:empty{display:none}',
    '.np-msg.np-ok{color:var(--label2)}',
    /* предупреждение о связи: висит только когда что-то не так */
    '.np-warn{position:fixed;left:50%;bottom:calc(10px + env(safe-area-inset-bottom));z-index:39;',
      'transform:translate(-50%,14px);opacity:0;pointer-events:none;',
      'padding:7px 14px;border-radius:999px;background:var(--red-b,#E7362B);color:#fff;',
      'font:600 13px/1 -apple-system,system-ui,sans-serif;letter-spacing:-.1px;white-space:nowrap;',
      'box-shadow:0 6px 18px -6px rgba(0,0,0,.5);transition:opacity .3s ease,transform .3s var(--spring,ease)}',
    '.np-warn.np-show{opacity:1;transform:translate(-50%,0)}'
  ].join('');

  var HTML =
    '<div class="np-back" id="npBack"></div>' +
    '<aside class="np-sheet" id="npSheet" role="dialog" aria-modal="true" aria-labelledby="npTitle">' +
      '<div class="np-grab"></div>' +
      '<h2 id="npTitle">Игра по сети</h2>' +
      '<p class="np-sub" id="npSub">Один создаёт комнату, второй входит по коду</p>' +
      '<div class="np-pane" id="npPick">' +
        '<input class="np-name" id="npName" type="text" maxlength="12" autocomplete="off" enterkeyhint="done" ' +
               'placeholder="Ваше имя" aria-label="Ваше имя">' +
        '<button class="np-go" id="npNew" type="button">Создать комнату</button>' +
        '<button class="np-alt" id="npHas" type="button">У меня есть код</button>' +
      '</div>' +
      '<div class="np-pane" id="npWait" hidden>' +
        '<div class="np-code" id="npCode" aria-label="Код комнаты">·····</div>' +
        '<p class="np-wait">Ждём соперника <span class="np-dot"><i></i><i></i><i></i></span></p>' +
        '<button class="np-go" id="npShare" type="button">Поделиться ссылкой</button>' +
        '<button class="np-alt" id="npCancel" type="button">Отмена</button>' +
      '</div>' +
      '<div class="np-pane" id="npEnter" hidden>' +
        '<input class="np-in" id="npInput" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="5" ' +
               'placeholder="00000" autocomplete="off" aria-label="Код комнаты">' +
        '<button class="np-go" id="npJoin" type="button">Войти</button>' +
        '<button class="np-alt" id="npBackBtn" type="button">Назад</button>' +
      '</div>' +
      '<div class="np-msg" id="npMsg"></div>' +
    '</aside>' +
    '<div class="np-warn" id="npWarn"></div>';

  /* Пока в лобби набирают имя или код, у шторки класс np-typing — она стоит
     у верхнего края экрана, куда клавиатура не достаёт. Первая попытка (27.09)
     поднимала шторку на высоту клавиатуры по visualViewport, но на телефоне
     это уносило всё за край: высоту клавиатуры iPhone, Telegram и Android
     считают по-разному. Верхний край от неё не зависит. */
  function typing(){
    var field = function(a){ return !!a && el.sheet.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName); };
    el.sheet.addEventListener('focusin', function(e){ if (field(e.target)) el.sheet.classList.add('np-typing'); });
    el.sheet.addEventListener('focusout', function(){
      /* не сразу: нажатие на кнопку должно попасть туда, куда целились */
      setTimeout(function(){ if (!field(document.activeElement)) el.sheet.classList.remove('np-typing'); }, 200);
    });
  }

  function build(){
    if (el.sheet) return;
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    var box = document.createElement('div');
    box.innerHTML = HTML;
    while (box.firstChild) document.body.appendChild(box.firstChild);

    var id = function(n){ return document.getElementById(n); };
    el = { sheet:id('npSheet'), back:id('npBack'), sub:id('npSub'), msg:id('npMsg'),
           code:id('npCode'), input:id('npInput'), join:id('npJoin'), make:id('npNew'),
           name:id('npName'), warn:id('npWarn'),
           panes:{ pick:id('npPick'), wait:id('npWait'), enter:id('npEnter') } };

    typing();

    /* имя сохраняем сразу, чтобы оно подставилось и в следующий раз, и в играх */
    el.name.value = myName();
    el.name.addEventListener('input', function(){ saveMyName(el.name.value); });
    el.name.addEventListener('keydown', function(e){
      if (e.key === 'Enter'){ e.preventDefault(); try{ el.name.blur(); }catch(err){} }
    });
    el.make.addEventListener('click', create);
    id('npHas').addEventListener('click', function(){
      pane('enter');
      /* Клавиатуру поднимаем, когда шторка доехала. Если к этому времени код
         уже введён целиком (вставили из буфера, подставила автоподсказка),
         поднимать её незачем — она только закроет собой экран. */
      clearTimeout(focusAt);
      focusAt = setTimeout(function(){
        if (el.input.value.replace(/\D/g, '').length === 5) return;
        try{ el.input.focus(); }catch(e){}
      }, 340);
    });
    id('npBackBtn').addEventListener('click', function(){ pane('pick'); });
    id('npCancel').addEventListener('click', cancel);
    id('npShare').addEventListener('click', share);
    el.join.addEventListener('click', function(){ join(el.input.value); });
    el.input.addEventListener('input', function(){
      var v = el.input.value.replace(/\D/g, '').slice(0, 5);
      if (v !== el.input.value) el.input.value = v;
      say('');
      if (v.length === 5){
        /* код введён целиком — клавиатура телефона больше не нужна и
           иначе остаётся висеть поверх игры */
        clearTimeout(focusAt);
        try{ el.input.blur(); }catch(e){}
        join(v);
      }
    });
    el.input.addEventListener('keydown', function(e){
      if (e.key === 'Enter'){
        e.preventDefault();
        try{ el.input.blur(); }catch(err){}
        join(el.input.value);
      }
    });
    el.back.addEventListener('click', cancel);
    var sy = null;
    el.sheet.addEventListener('pointerdown', function(e){ sy = e.clientY; });
    el.sheet.addEventListener('pointerup', function(e){
      if (sy !== null && e.clientY - sy > 60) cancel();
      sy = null;
    });
    /* щелчок по кнопкам лобби — тем же звуком, что и везде в игре */
    el.sheet.addEventListener('pointerdown', function(e){
      var n = e.target;
      while (n && n.nodeType === 1 && n !== el.sheet){
        if (n.classList && (n.classList.contains('np-go') || n.classList.contains('np-alt'))){
          try{ FX.fire(5, 'light'); }catch(err){}
          return;
        }
        n = n.parentNode;
      }
    }, true);
  }

  var SUB = { pick:'Один создаёт комнату, второй входит по коду',
              wait:'Назовите код сопернику или отправьте ссылку',
              enter:'Введите пять цифр из комнаты соперника' };

  function say(msg, good){
    el.msg.textContent = msg || '';
    el.msg.className = 'np-msg' + (good ? ' np-ok' : '');
  }
  function pane(name){
    for (var k in el.panes) el.panes[k].hidden = (k !== name);
    el.sub.textContent = SUB[name];
    say('');
  }
  function open(){
    build();
    el.code.textContent = '·····';
    el.name.value = myName();
    pane('pick');
    document.body.classList.add('np-open');
  }
  function close(){
    document.body.classList.remove('np-open');
    try{ if (el.input) el.input.blur(); }catch(e){}
    try{ if (el.name) el.name.blur(); }catch(e){}
    if (el.sheet) el.sheet.classList.remove('np-typing');
  }

  function announce(t){
    var l = document.getElementById('live');
    if (l) l.textContent = t;
  }

  /* ---------- связь ---------- */
  /* У запроса есть предел ожидания. Без него запрос, повисший в сети (лифт,
     переход с Wi-Fi на мобильную связь), висел бы минутами: следующий опрос
     ставится только после ответа на предыдущий, и партия у игрока просто
     замирала бы — даже без предупреждения о связи. Через 8 секунд запрос
     считается несостоявшимся, как обрыв: опрос повторится, а ход уйдёт
     снова — сервер повтор узнает по метке и дважды не применит. */
  var WAIT = 8000;
  function call(action, body){
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var cut = ctl ? setTimeout(function(){ try { ctl.abort(); } catch(e){} }, WAIT) : 0;
    var none = function(){ clearTimeout(cut); return { status: 0, body: { error: 'Нет связи с сервером' } }; };
    return fetch('/api/' + action, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: ctl ? ctl.signal : undefined
    }).then(function(r){
      return r.text().then(function(t){
        clearTimeout(cut);
        var j = null;
        try { j = JSON.parse(t); } catch(e){}
        if (!j) j = { error: 'Сетевая игра на этом адресе не работает' };
        return { status: r.status, body: j };
      }, none);
    }, none);
  }

  /* счёт ходов глазами игры — по нему видно, что у неё разъехалось поле */
  function applied(){
    try { return opt && opt.applied ? (opt.applied() | 0) : 0; } catch(e){ return 0; }
  }
  function have(){ return known; }
  /* Игра не приняла ход или приняла дважды: её счёт разошёлся с нашим, и
     поле у неё уже не то. Смотрим только в спокойную минуту — когда наша
     очередь пуста, свои ходы отправлены и у игры не идёт анимация. */
  function crooked(){
    if (!api_.live || over) return false;
    if (queue.length || outbox.length || busy()) return false;
    return applied() !== known;
  }
  /* игра сама говорит, можно ли ей сейчас отдать ход */
  function busy(){
    try { return !!(opt && opt.busy && opt.busy()); } catch(e){ return false; }
  }
  function drain(){
    clearTimeout(feeder);
    if (!queue.length || !api_.on) return;
    if (busy()){ feeder = setTimeout(drain, 150); return; }
    var it = queue.shift();
    fire('move', it.v, it.quick);
    if (queue.length) feeder = setTimeout(drain, 40);
  }

  /* Опрос разряжаем, когда ждать нечего: каждый запрос — обращение к
     серверной функции, и лишние запросы не только тратят лимит, но и
     сталкиваются с ходами. Быстро опрашивает только тот, кто ждёт чужой ход. */
  function rate(){
    /* Чем дольше на сервере ничего не меняется, тем реже туда стучимся:
       комнату могли просто бросить открытой, и незачем полчаса её опрашивать. */
    var still = markAt ? Date.now() - markAt : 0;
    if (!api_.live) return still > 60000 ? 3000 : 1500;       /* лобби */
    if (over) return still > 30000 ? 2500 : 1200;             /* ждём реванша */
    if (hidden()) return 4000;                                /* на экран не смотрят */
    /* без очереди чужой ход может прийти в любую секунду, а игра на скорость:
       каждая лишняя доля секунды — это карта, увиденная позже соперника */
    if (free()) return still > 60000 ? 2000 : 600;
    if (api_.turn && api_.turn === api_.seat){                /* ход наш, ждать нечего */
      return still > 60000 ? 4000 : 2600;
    }
    return still > 120000 ? 2000 : 900;                       /* ждём чужой ход */
  }
  function hidden(){
    try { return !!document.hidden; } catch(e){ return false; }
  }
  /* видно ли сервер: пилюля внизу должна объяснять, почему игра встала */
  function link(){
    var bad = pollBad > 2 || sendBad > 2;
    if (bad === lost) return;
    lost = bad;
    warn();
  }
  function poll(ms){
    clearTimeout(timer);
    if (!api_.on) return;
    timer = setTimeout(step, ms === undefined ? rate() : ms);
  }
  /* Каждому запросу — свой номер. Ответ, который опоздал и устарел, мы
     выбрасываем: иначе он выглядит как «мы убежали вперёд сервера» и зря
     запускает пересборку раунда. */
  function step(){
    if (!api_.on) return;
    var g = ++gen;
    call('state', { code:api_.code, token:api_.token, since:have() }).then(function(res){
      if (g !== gen || !api_.on) return;
      if (res.status === 0 || res.status >= 500){   /* сервер не ответил — подождём и спросим снова */
        pollBad++; link();
        poll(Math.min(900 + pollBad * 500, 3000));
        return;
      }
      pollBad = 0; link();
      apply(res);
      poll();
    });
  }

  function apply(res){
    if (!api_.on) return;
    if (res.status === 404 || res.status === 410){ fail('Комната закрылась'); return; }
    if (res.status === 403){ fail('Вас нет в этой комнате'); return; }
    if (res.status !== 200) return;          /* 409 и прочее — ждём следующего опроса */
    var v = res.body;
    var sign = [v.total, v.round, v.turn, v.joined ? 1 : 0, v.oppOnline ? 1 : 0,
                v.oppLeft ? 1 : 0, (v.rematch || []).join('')].join('|');
    if (sign !== mark){ mark = sign; markAt = Date.now(); }
    if (v.seat) api_.seat = v.seat;
    api_.oppOnline = !!v.oppOnline;
    api_.oppLeft = !!v.oppLeft;
    if (v.oppName) api_.oppName = v.oppName;
    /* Очередь по мнению сервера. Игра ведёт свою, но если её местный отсчёт
       отстал — скажем, телефон погасил экран и браузер придержал таймеры —
       игра догоняет по этой цифре. */
    var wasTurn = api_.turn;
    api_.turn = v.turn | 0;

    if (!api_.live){                          /* сидим в комнате и ждём второго */
      if (v.joined){ close(); begin(); }
      return;
    }
    warn();

    if (v.round > api_.round){                /* оба согласились на реванш */
      outbox.length = 0;                      /* ходы прошлого раунда уже ни к чему */
      api_.round = v.round;
      over = false;
      queue.length = 0;                       /* ходы прошлого раунда уже не нужны */
      known = 0;
      askew = 0;
      fixes = 0;
      clearTimeout(feeder);
      seedRound();
      resetAgain();
      fire('round', { seat:api_.seat, round:api_.round, seed:api_.seed, rng:api_.rng });
      return;
    }
    /* Мы забежали вперёд сервера. Если в очереди лежат неотправленные ходы,
       то ровно на них он и отстаёт — это не рассинхрон, а ожидание связи:
       пересобирать раунд нельзя, иначе свой же ход мигнёт и пропадёт.
       Без очереди свои ходы в `known` не входят вовсе, вычитать нечего. */
    if (v.total < known - (free() ? 0 : outbox.length)){ resync(); return; }
    if (v.moves && v.moves.length){
      var quick = v.moves.length > 1;         /* догоняем пачку — без анимации */
      for (var i = 0; i < v.moves.length; i++){
        if ((v.since + i) !== known) continue;
        queue.push({ v: v.moves[i], quick: quick });
        known++;
      }
      drain();
    }
    /* Очередь по мнению сервера отдаём игре КАЖДЫЙ раз, а не только когда
       она изменилась: одноразовая поправка, пришедшая в неподходящий миг,
       была бы отброшена, и игра осталась бы с неверной очередью навсегда.
       Но только когда мы с сервером в одной точке: его `turn` — это мир
       ПОСЛЕ всех его ходов, и пока мы эти ходы не разобрали, подсказка
       говорит о будущем. Игра, поверив ей раньше времени, запишет чужие
       ходы не на того игрока: поле у обоих одинаковое, а счёт разный.
       Без очереди подсказывать нечего. */
    if (!free() && api_.live && api_.turn && v.total === known && !queue.length && !outbox.length)
      fire('turn', api_.turn, api_.turn !== wasTurn);
    /* Счёт ходов у игры разошёлся с нашим — ход до поля не доехал. Ждём
       подтверждения на двух опросах подряд, чтобы не пересобирать раунд
       из-за случайного мгновения, и собираем поле заново. Больше одного раза
       за раунд так не лечим: если и после пересборки счёт не сошёлся, значит
       в списке есть ход, который игра разыграть не может, и вторая попытка
       даст ровно то же самое — только на экране ходы будут повторяться без
       конца, а это хуже любой рассинхронизации. */
    if (crooked()){
      if (++askew >= 2 && fixes < 1){ askew = 0; fixes++; resync(true); return; }
    } else askew = 0;
    syncAgain(v);
  }

  /* поле разъехалось с сервером — собираем заново по списку ходов */
  function resync(force){
    /* Пересборка — дорогое лекарство: поле собирается с нуля на глазах у
       игрока. Чаще раза в три секунды её не запускаем, иначе одна упрямая
       причина превратится в бесконечный перебор ходов на экране. */
    if (Date.now() - syncAt < 3000) return;
    syncAt = Date.now();
    try{ console.warn('[net] пересборка раунда: у нас '+known+' ходов, у игры '+applied()); }catch(e){}
    var g = ++gen;
    call('state', { code:api_.code, token:api_.token, since:0 }).then(function(res){
      if (g !== gen || !api_.on || res.status !== 200) return;
      var v = res.body, i;
      /* Перепроверка: обычно тревога ложная — просто пришёл запоздавший ответ.
         Пересобирать раунд без нужды нельзя: счёт партий посчитается дважды.
         Но если счёт ходов у игры не сходится с нашим, поле уже не то —
         тогда пересобираем не спрашивая. */
      if (!force && v.round === api_.round && v.total >= known){
        apply({ status: 200, body: v });
        return;
      }
      try{ console.warn('[net] пересборка ПОДТВЕРЖДЕНА: сервер '+v.total+', раунд '+v.round); }catch(e){}
      api_.round = v.round;
      over = false;
      queue.length = 0;
      known = 0;
      askew = 0;
      clearTimeout(feeder);
      seedRound();
      fire('round', { seat:api_.seat, round:api_.round, seed:api_.seed, rng:api_.rng });
      /* поле собираем тем же путём, что и обычные ходы: по одному, дожидаясь
         игру — иначе двадцать ходов подряд свалятся в одну анимацию */
      for (i = 0; i < v.moves.length; i++){ queue.push({ v: v.moves[i], quick: true }); known++; }
      drain();
      warn();
    });
  }

  function fire(name, a, b){
    if (!opt || typeof opt[name] !== 'function') return;
    try { opt[name](a, b); } catch(e){}
  }

  function begin(){
    api_.live = true;
    over = false;
    known = 0;
    askew = 0;
    fixes = 0;
    queue.length = 0;
    seedRound();
    document.body.classList.add('np-play');
    fire('begin', { seat:api_.seat, round:api_.round, seed:api_.seed, rng:api_.rng });
    announce('Соперник подключился');
    poll(500);
  }

  function create(){
    el.make.disabled = true; el.make.textContent = 'Создаём…';
    el.code.textContent = '·····';
    api_.myName = myName();
    call('create', { game: opt ? opt.game : 'dvoeplay', name: api_.myName, free: free() }).then(function(res){
      el.make.disabled = false; el.make.textContent = 'Создать комнату';
      if (res.status !== 200){ say(res.body.error || 'Не получилось создать комнату'); return; }
      api_.code = res.body.code; api_.token = res.body.token;
      api_.seat = 1; api_.round = 0; api_.seed = res.body.seed;
      api_.on = true; api_.live = false; api_.oppLeft = false; api_.oppOnline = false;
      api_.oppName = '';
      el.code.textContent = api_.code;
      pane('wait');
      poll(800);
    });
  }

  function join(code){
    code = String(code || '').replace(/\D/g, '');
    if (code.length !== 5){ say('Нужны пять цифр'); return; }
    el.join.disabled = true; el.join.textContent = 'Входим…';
    api_.myName = myName();
    call('join', { code: code, game: opt ? opt.game : undefined, name: api_.myName }).then(function(res){
      el.join.disabled = false; el.join.textContent = 'Войти';
      if (res.status !== 200){ say(res.body.error || 'Не получилось войти'); return; }
      api_.code = code; api_.token = res.body.token;
      api_.seat = 2; api_.round = res.body.round | 0; api_.seed = res.body.seed;
      api_.on = true; api_.oppLeft = false; api_.oppOnline = true;
      api_.oppName = res.body.oppName || '';
      close();
      begin();
    });
  }

  /* Ход этого игрока: next — кому переходит очередь (1 или 2).
     Ход не отправляется «в один конец»: он встаёт в очередь и уходит
     снова и снова, пока сервер не подтвердит. У каждого хода своя метка,
     поэтому повтор не применится дважды. Без очереди next не нужен, а свой
     ход засчитывается, только когда вернётся с сервера. */
  function send(move, next){
    if (!api_.on) return;
    if (!free()) known++;                    /* свой ход — тоже ход раунда */
    outbox.push({ move: move, next: next | 0, round: api_.round,
                  mid: midTag + ':' + (++midNo), tries: 0 });
    flush();
  }

  function flush(){
    if (sending || !outbox.length || !api_.on) return;
    var it = outbox[0];
    sending = true;
    var g = ++gen;
    call('move', { code:api_.code, token:api_.token, move:it.move, mid:it.mid,
                   round:it.round, next:it.next, since:have() }).then(function(res){
      sending = false;
      if (!api_.on) return;
      if (res.status === 200){
        outbox.shift();
        sendBad = 0; link();
        if (g === gen) apply(res);
        /* без очереди свой ход приходит обратно в этом же ответе; если ответ
           устарел и выброшен — спрашиваем сразу, а не через обычную паузу */
        if (outbox.length) flush(); else poll(free() ? (g === gen ? 600 : 60) : 900);
        return;
      }
      if (res.status === 404 || res.status === 403 || res.status === 410){
        outbox.length = 0;
        apply(res);
        return;
      }
      if (res.status === 409 || res.status === 400){
        /* Сервер ход не принял: сменился раунд, очередь не наша или наша
           картина поля отстала. Ходы, что стоят следом, построены на ней же —
           значит негодны все. Собираем поле заново по серверу. */
        try{ console.warn('[net] ход отвергнут сервером: ' + ((res.body && res.body.error) || res.status)); }catch(e){}
        outbox.length = 0;
        sendBad = 0; link();
        resync(true);
        return;
      }
      /* связь или сервер подвели: ход цел, пробуем ещё раз */
      it.tries++; sendBad++; link();
      setTimeout(flush, Math.min(400 * it.tries, 2500));
    });
  }

  function result(winner){
    over = true;
    if (!api_.on) return;
    gen++;                                   /* прежние ответы уже неактуальны */
    call('result', { code:api_.code, token:api_.token, winner: winner | 0 });
    poll(700);
  }

  /* ---------- реванш ---------- */
  function againEl(){ return document.getElementById('again'); }
  function resetAgain(){
    var b = againEl();
    if (!b) return;
    b.disabled = false;
    if (againLabel) b.textContent = againLabel;
  }
  function rematch(){
    if (!api_.on) return;
    var b = againEl();
    if (b){
      if (!againLabel) againLabel = b.textContent;
      b.disabled = true; b.textContent = 'Ждём соперника…';
    }
    var g = ++gen;
    call('again', { code:api_.code, token:api_.token }).then(function(res){
      if (g !== gen || !api_.on) return;
      if (res.status !== 200){ resetAgain(); return; }
      apply(res);
    });
    poll(700);
  }
  function syncAgain(v){
    if (!over || !v.rematch) return;
    var b = againEl();
    if (!b) return;
    if (!againLabel) againLabel = b.textContent;
    if (v.rematch[api_.seat - 1]){ b.disabled = true; b.textContent = 'Ждём соперника…'; }
    else if (v.rematch[2 - api_.seat]){ b.disabled = false; b.textContent = 'Соперник готов — играем'; }
    else resetAgain();
    fire('again', !!v.rematch[api_.seat - 1], !!v.rematch[2 - api_.seat]);
  }

  /* ---------- связь с соперником ---------- */
  function warn(){
    if (!el.warn) return;
    var msg = lost ? 'Нет связи с сервером'
            : api_.oppLeft ? 'Соперник вышел из игры'
            : !api_.oppOnline ? 'Соперник не на связи' : '';
    if (msg){ el.warn.textContent = msg; el.warn.classList.add('np-show'); }
    else el.warn.classList.remove('np-show');
    fire('peer', { online: api_.oppOnline, left: api_.oppLeft });
  }

  /* ---------- выход ---------- */
  function stop(){
    api_.on = false; api_.live = false;
    clearTimeout(timer); clearTimeout(feeder); gen++;
    queue.length = 0;
    known = 0; askew = 0; fixes = 0;
    outbox.length = 0; sending = false;
    pollBad = 0; sendBad = 0; lost = false;
    over = false;
    document.body.classList.remove('np-play');
    if (el.warn) el.warn.classList.remove('np-show');
    resetAgain();
  }
  function leave(){
    if (!api_.on) return;
    var c = api_.code, t = api_.token;
    stop();
    call('leave', { code:c, token:t });
  }
  /* «Отмена» и смахивание: из лобби выходим совсем, из партии просто прячем шторку */
  function cancel(){
    if (api_.on && !api_.live) leave();
    close();
  }
  function fail(msg){
    var wasLive = api_.live;
    stop();
    if (wasLive) fire('ended');
    open();
    say(msg);
  }

  function share(){
    var url = location.origin + location.pathname + '?room=' + api_.code;
    var name = (opt && opt.title) ? opt.title : 'dvoeplay';
    if (navigator.share){
      navigator.share({ title: 'dvoeplay — ' + name,
        text: 'Заходи в «' + name + '», код комнаты ' + api_.code, url: url })
        .catch(function(){});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(function(){ say('Ссылка скопирована', true); },
                                             function(){ say(url, true); });
    } else say(url, true);
  }

  /* ---------- подключение игры ---------- */
  function init(o){
    opt = o || {};
    build();
    /* вернулись к игре после блокировки экрана — спрашиваем сервер сразу,
       не дожидаясь разряженного «фонового» опроса */
    try {
      document.addEventListener('visibilitychange', function(){
        if (api_.on && !hidden()){ flush(); poll(200); }
      });
    } catch(e){}
    /* переход по приглашению: ?room=12345 — код подставляем сами */
    var m = /[?&]room=(\d{5})/.exec(location.search);
    if (!m) return;
    try { history.replaceState(null, '', location.pathname); } catch(e){}
    open(); pane('enter'); el.input.value = m[1];
    setTimeout(function(){ join(m[1]); }, 300);
  }

  api_.init = init;
  api_.open = open;
  api_.close = close;
  api_.cancel = cancel;
  api_.send = send;
  api_.result = result;
  api_.rematch = rematch;
  api_.leave = leave;
  api_.stop = stop;
  return api_;
})();
