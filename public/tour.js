/* ---------- мини-турнир, общий модуль dvoeplay ----------
   Подключается во всех играх и на главном экране строкой
   <script src="tour.js"></script> — перед скриптом страницы.

   Турнир — несколько игр подряд вдвоём на одном телефоне; проигравший
   выполняет фант, который перед стартом втайне вписал победитель.
   Главный экран турнир собирает (имена, игры, фанты) и показывает итог,
   а игры его только продолжают: открывшись по ссылке ?tour=<номер>, игра
   сразу начинает партию вдвоём, а когда партия кончилась — записывает итог
   и кладёт в свою шторку итога панель турнира с кнопкой «Дальше».

   Итог партии модуль узнаёт из события dp:save, которое бросает общий
   блок памяти DP после каждой записи. Сами игры для турнира не менялись:
   у всех десяти одинаковы строка меню «Вдвоём» (.row[data-mode="2"]),
   шторка итога #sheet, кнопка #again и фант .forfeit — это сверяет audit.py.

   Всё хранится в общей памяти приложения (dvoeplay:v1 → tour):
     id     — номер турнира (время начала); он же в ссылке ?tour=
     games  — id игр по порядку; решающие игры дописываются в конец
     res    — итоги сыгранных: 1 — первый игрок (красные, «я»),
              2 — второй (жёлтые, «друг»), 0 — ничья
     titles — {id: название} — у игр нет каталога, названия дал хаб
     pool   — все игры, из которых тянется решающая
     f      — [фант, который выполнит первый, фант, который выполнит второй];
              каждый вписывает соперник
     tb     — сколько решающих игр дописано
     part   — итоги раундов текущей игры, пока она не доиграна (только
              там, где игра в турнире идёт в несколько раундов, см. ROUNDS) */
var TOUR = (function(){
  var KEY = 'dvoeplay:v1';

  function all(){
    try { var d = JSON.parse(localStorage.getItem(KEY)); if (d && d.games) return d; } catch(e){}
    return { v:1, games:{} };
  }
  function put(d){ try { localStorage.setItem(KEY, JSON.stringify(d)); } catch(e){} }
  function read(){
    var t = all().tour;
    return (t && t.id && t.games && t.games.length) ? t : null;
  }
  function write(t){ var d = all(); if (t) d.tour = t; else delete d.tour; put(d); }

  /* ---------- счёт и очередь: чистые функции, их проверяет тест ---------- */
  function played(t){ return (t.res || []).length; }
  function score(t){
    var a = 0, b = 0;
    (t.res || []).forEach(function(r){ if (r === 1) a++; else if (r === 2) b++; });
    return [a, b];
  }
  function current(t){ return played(t) < t.games.length ? t.games[played(t)] : ''; }
  /* победитель есть, только когда сыграно всё и не поровну */
  function winner(t){
    if (played(t) < t.games.length) return 0;
    var s = score(t);
    return s[0] > s[1] ? 1 : (s[1] > s[0] ? 2 : 0);
  }
  function over(t){ return !!t && winner(t) > 0; }
  /* сколько игр задумано изначально — решающие в «из N» не входят */
  function planned(t){ return t.games.length - (t.tb || 0); }

  /* Записать итог сыгранной игры. Если всё сыграно, а поровну —
     дописывается решающая: случайная из тех, что в турнире ещё не было;
     если были все — любая, кроме только что сыгранной. */
  function record(t, win, rnd){
    t.res = (t.res || []).concat([(win === 1 || win === 2) ? win : 0]);
    if (played(t) >= t.games.length && !winner(t)){
      var used = {}, pool = t.pool || [], last = t.games[t.games.length - 1], left;
      t.games.forEach(function(g){ used[g] = 1; });
      left = pool.filter(function(g){ return !used[g]; });
      if (!left.length) left = pool.filter(function(g){ return g !== last; });
      if (!left.length) left = [last];
      t.games = t.games.concat([left[Math.floor((rnd || Math.random)() * left.length)]]);
      t.tb = (t.tb || 0) + 1;
    }
    return t;
  }
  /* Сколько раундов в одной игре турнира. Почти везде партия и так честная:
     оба в равном положении. «Виселица» — нет: один загадывает, другой
     отгадывает. Поэтому в турнире её играют дважды, поменявшись ролями, и
     игру берёт тот, кто выиграл больше раундов; 1 : 1 — ничья. */
  var ROUNDS = { viselica: 2 };
  function rounds(id){ return ROUNDS[id] || 1; }
  /* Записать итог раунда. Набралось сколько нужно — это итог игры. */
  function step(t, win, rnd){
    var part = (t.part || []).concat([(win === 1 || win === 2) ? win : 0]), a = 0, b = 0;
    if (part.length < rounds(current(t))){ t.part = part; return t; }
    part.forEach(function(r){ if (r === 1) a++; else if (r === 2) b++; });
    delete t.part;
    return record(t, a > b ? 1 : (b > a ? 2 : 0), rnd);
  }
  function link(t){
    var g = current(t);
    return (g ? g : 'index') + '.html?tour=' + t.id;
  }
  function start(cfg){
    var t = { id: Date.now(), games: cfg.games.slice(), res: [],
              titles: cfg.titles || {}, pool: cfg.pool || cfg.games.slice(), f: cfg.f.slice(0, 2), tb: 0 };
    write(t);
    return t;
  }
  function title(t, id){ return (t.titles && t.titles[id]) || id; }
  /* Кто играет, турнир не хранит: имена те же, что в играх, из общей памяти
     (names.me — красные, names.friend — жёлтые), и читаются всякий раз заново.
     Имени нет — сторона зовётся по цвету, как в самих играх. */
  function clip(s){ return String(s == null ? '' : s).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').slice(0, 12); }
  function names(){
    var n = all().names || {};
    return [clip(n.me) || 'Красные', clip(n.friend) || 'Жёлтые'];
  }

  /* ---------- в игре ---------- */
  function page(){ var m = /([^\/]+)\.html$/.exec(location.pathname); return m ? m[1] : 'index'; }
  function asked(){ var m = /[?&]tour=(\d+)/.exec(location.search); return m ? +m[1] : 0; }
  var mine = 0;                          /* номер турнира, который ведёт эта страница */

  function esc(s){
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function style(){
    if (document.getElementById('trStyle')) return;
    var st = document.createElement('style');
    st.id = 'trStyle';
    /* свои имена с приставкой tr- и только общие токены серии: они есть во всех играх */
    st.textContent =
      'html.in-tour #again,html.in-tour .forfeit{display:none!important}' +
      '.tr-panel{margin:4px 0 12px;padding:12px 14px 14px;border-radius:16px;background:var(--fill);text-align:center}' +
      '.tr-head{font-size:11.5px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:var(--label2)}' +
      '.tr-score{display:flex;align-items:center;justify-content:center;gap:9px;margin:7px 0 9px;font-size:15px;font-weight:600;color:var(--label)}' +
      '.tr-score span{display:flex;align-items:center;gap:5px;min-width:0;max-width:40%}' +
      '.tr-score span em{font-style:normal;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.tr-score span::before{content:"";flex:none;width:9px;height:9px;border-radius:50%;background:var(--red-b)}' +
      '.tr-score span.b::before{background:var(--yel-b)}' +
      '.tr-score b{font-size:22px;font-weight:700;letter-spacing:-.5px;font-variant-numeric:tabular-nums}' +
      '.tr-dots{display:flex;justify-content:center;gap:6px;margin:0 0 12px}' +
      '.tr-dots i{width:10px;height:10px;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--label3)}' +
      '.tr-dots i.a{background:var(--red-b);box-shadow:none}' +
      '.tr-dots i.b{background:var(--yel-b);box-shadow:none}' +
      '.tr-dots i.d{background:var(--label3);box-shadow:none}' +
      '.tr-dots i.now{box-shadow:inset 0 0 0 2px var(--tint)}' +
      '.tr-note{margin:-3px 0 11px;font-size:13px;color:var(--label2)}' +
      '.tr-next{display:block;width:100%;box-sizing:border-box;padding:15px 14px;border:0;border-radius:14px;background:var(--tint);' +
        'color:#fff;text-decoration:none;text-align:center;cursor:pointer;' +
        'font:600 17px/1.15 -apple-system,system-ui,sans-serif;letter-spacing:-.3px;transition:transform .16s cubic-bezier(.34,1.48,.5,1)}' +
      '.tr-next:active{transform:scale(.98)}';
    document.head.appendChild(st);
  }
  /* панель турнира в шторке итога — перед кнопкой «Играть снова», которая в турнире спрятана */
  function panel(){
    var t = read(), again = document.getElementById('again');
    if (!t || t.id !== mine || !again) return;
    var box = document.getElementById('trPanel');
    if (!box){
      box = document.createElement('div');
      box.id = 'trPanel'; box.className = 'tr-panel';
      again.parentNode.insertBefore(box, again);
    }
    var s = score(t), n = played(t), nx = current(t), plan = planned(t), part = (t.part || []).length, who = names();
    /* раунды игры ещё идут — номер у неё следующий за сыгранными */
    var no = part ? n + 1 : n;
    var head = no > plan ? 'Турнир · решающая игра' : 'Турнир · игра ' + no + ' из ' + plan;
    var dots = t.games.map(function(g, i){
      var r = t.res[i];
      return '<i' + (r === 1 ? ' class="a"' : r === 2 ? ' class="b"' : r === 0 ? ' class="d"' : (part && i === n) ? ' class="now"' : '') + '></i>';
    }).join('');
    var note = '', label;
    if (part){ note = 'Раунд ' + part + ' из ' + rounds(nx) + ' — теперь роли меняются'; label = (ORD[part] || 'Следующий') + ' раунд'; }
    else if (over(t)){ head = 'Турнир окончен'; label = 'Итоги и фант'; }
    else if (n === t.games.length - 1 && n >= plan){ note = 'Поровну — всё решит ещё одна игра'; label = 'Решающая: ' + title(t, nx); }
    else label = 'Дальше: ' + title(t, nx);
    box.innerHTML =
      '<div class="tr-head">' + esc(head) + '</div>' +
      '<div class="tr-score"><span><em>' + esc(who[0]) + '</em></span><b>' + s[0] + ' : ' + s[1] + '</b>' +
        '<span class="b"><em>' + esc(who[1]) + '</em></span></div>' +
      '<div class="tr-dots" aria-hidden="true">' + dots + '</div>' +
      (note ? '<p class="tr-note">' + esc(note) + '</p>' : '') +
      /* следующий раунд — та же страница: кнопка просто жмёт спрятанное «Играть снова» */
      (part ? '<button class="tr-next" id="trNext" type="button">' + esc(label) + '</button>'
            : '<a class="tr-next" id="trNext" href="' + esc(link(t)) + '">' + esc(label) + '</a>');
    if (part) document.getElementById('trNext').addEventListener('click', function(){
      var a = document.getElementById('again');
      if (a) a.click();
    });
  }
  var ORD = ['', 'Второй', 'Третий', 'Четвёртый'];
  /* партия не турнирная — шторка итога обычная: с «Играть снова» и фантом */
  function calm(){
    var box = document.getElementById('trPanel');
    document.documentElement.classList.remove('in-tour');
    if (box) box.parentNode.removeChild(box);
    between = false;
  }
  var between = false;                   /* раунд записан, следующий ещё не начали */
  function saved(e){
    var d = (e && e.detail) || {}, t = read();
    /* в турнир идёт партия только вдвоём на одном телефоне и только той игры,
       что сейчас по очереди; любая другая — сама по себе */
    if (!t || t.id !== mine || d.mode !== 2 || (window.NET && NET.on) || current(t) !== d.id){ calm(); return; }
    step(t, d.win);
    write(t);
    between = !!(t.part && t.part.length);
    document.documentElement.classList.add('in-tour');
    panel();
  }
  /* правки раундов текущей игры, если игра начинается заново */
  function rewind(pop){
    var t = read();
    if (!t || t.id !== mine || !t.part) return;
    if (pop) t.part.pop(); else t.part = [];
    if (!t.part.length) delete t.part;
    write(t);
  }
  function boot(){
    var row = document.querySelector('.row[data-mode="2"]');
    if (!row || !document.getElementById('sheet')) return;    /* это не игра — главный экран */
    var id = asked(), t = read();
    if (!id || !t || t.id !== id || over(t) || current(t) !== page()) return;
    mine = id;
    rewind(false);                                             /* страница открыта заново — игра с начала */
    style();
    document.addEventListener('dp:save', saved);
    document.addEventListener('click', function(e){
      var el = e.target && e.target.closest ? e.target : null;
      if (!el) return;
      /* новая партия из меню — прошлые раунды этой игры не в счёт */
      if (el.closest('.row[data-mode]')){ rewind(false); between = false; }
      /* «Начать заново» между раундами переигрывает сыгранный раунд теми же
         ролями (так в «Виселице») — его итог снимаем */
      else if (el.closest('#reset') && between){ rewind(true); between = false; }
      else if (el.closest('#again')) between = false;
    }, true);
    row.click();                                               /* сразу партия вдвоём, без меню */
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else setTimeout(boot, 0);

  return { read: read, write: write, start: start, score: score, played: played, current: current,
           winner: winner, over: over, planned: planned, record: record, step: step, rounds: rounds,
           link: link, title: title, names: names };
})();
