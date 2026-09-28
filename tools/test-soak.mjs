/* Долгая сетевая партия на плохой связи: «Мемо-дуэль» и «Захлопни ящик».

   Жалоба, ради которой написан этот тест: в какой-то момент партии одно из
   устройств начинало само по себе переигрывать ходы обоих игроков — без
   конца. Обычные тесты этого не видели: они играют на идеальной связи и
   смотрят на правила, а не на то, что происходит, когда никто не нажимает.

   Здесь связь рвётся (часть запросов не доходит) и тормозит, партия идёт
   до конца раунда, и после каждого хода проверяется главное: **когда никто
   не нажимает, поле обязано стоять на месте**. Плюс разговор с сервером
   пишется целиком — см. tools/soakkit.mjs. */
import { BASE, wait, reporter, launch, tab, lobby, until } from './netkit.mjs';
import { probe, flaky, blackout, api, judge } from './soakkit.mjs';

const rep = reporter();
const ok = rep.ok;
const browser = await launch();

/* ───────── как выглядит и как ходит каждая игра ───────── */

const memo = {
  file: 'memo-duel.html',
  title: 'Мемо-дуэль',
  look: (p) => p.evaluate(() => ({
    playing: document.getElementById('app').classList.contains('playing'),
    turn: document.getElementById('score').classList.contains('p2') ? 1 : 0,
    seat: window.NET ? NET.seat : 0,
    up: [].map.call(document.querySelectorAll('#board .cell'), (c, i) => c.classList.contains('up') ? i : -1)
          .filter(i => i >= 0).join(','),
    won: [].map.call(document.querySelectorAll('#board .cell'), (c, i) => c.classList.contains('won') ? i : -1)
           .filter(i => i >= 0).join(','),
    score: document.getElementById('numA').textContent + ':' + document.getElementById('numB').textContent,
    over: document.getElementById('sheet').classList.contains('on')
  })),
  mine: (s) => s.turn === s.seat - 1,
  /* Ход — две карточки. Половину ходов берём настоящую пару (иначе партия
     не кончится никогда), половину — заведомо разные. */
  async move(p, step){
    const free = await p.evaluate((wantPair) => {
      const cells = [].slice.call(document.querySelectorAll('#board .cell'));
      const left = [];
      cells.forEach((c, i) => { if (!c.classList.contains('won') && !c.classList.contains('up')) left.push(i); });
      const key = (i) => cells[i].querySelector('.face.a svg').innerHTML;
      if (wantPair){
        for (let x = 0; x < left.length; x++)
          for (let y = x + 1; y < left.length; y++)
            if (key(left[x]) === key(left[y])) return [left[x], left[y]];
      }
      for (let x = 0; x < left.length; x++)
        for (let y = x + 1; y < left.length; y++)
          if (key(left[x]) !== key(left[y])) return [left[x], left[y]];
      return left.slice(0, 2);
    }, step % 2 === 0);
    if (free.length < 2) return false;
    const tap = (i) => p.evaluate(n => {
      const c = document.querySelectorAll('#board .cell .card')[n];
      if (c) c.click();
    }, i);
    await tap(free[0]);
    await wait(120);
    await tap(free[1]);
    await wait(1300);                       /* 760мс на суд плюс 420мс на промах */
    return true;
  }
};

const yaschik = {
  file: 'zahlopni-yaschik.html',
  title: 'Захлопни ящик',
  look: (p) => p.evaluate(() => ({
    playing: document.getElementById('app').classList.contains('playing'),
    turn: document.getElementById('rack').classList.contains('p2') ? 2 : 1,
    seat: window.NET ? NET.seat : 0,
    rolling: !!document.querySelector('#pit .die.throw'),
    shut: [].map.call(document.querySelectorAll('#rack .tile'), (t, i) => t.classList.contains('shut') ? i : -1)
            .filter(i => i >= 0).join(','),
    score: document.getElementById('score1').textContent + ':' + document.getElementById('score2').textContent,
    over: document.getElementById('sheet').classList.contains('on')
  })),
  mine: (s) => s.turn === s.seat,
  async move(p, step){
    await p.locator('#roll').click({ force: true });
    await until(p, yaschik.look, s => !s.rolling, 9000);
    await wait(150);
    const closed = await p.evaluate(() => {
      const tiles = [].slice.call(document.querySelectorAll('#rack .tile'));
      const open = [];
      tiles.forEach((t, i) => { if (!t.classList.contains('shut')) open.push(i + 1); });
      const m = /^Выпало (\d+)/.exec((document.getElementById('live').textContent || '').trim());
      const sum = m ? +m[1] : 0;
      if (!sum) return null;
      let found = null;
      (function pick(from, left, acc){
        if (found) return;
        if (left === 0){ found = acc.slice(); return; }
        for (let k = from; k < open.length; k++){
          if (open[k] > left) break;
          acc.push(open[k]);
          pick(k + 1, left - open[k], acc);
          acc.pop();
          if (found) return;
        }
      })(0, sum, []);
      if (!found) return null;
      found.forEach(n => tiles[n - 1].click());
      return found;
    });
    await wait(closed ? 1100 : 1400);       /* передача хода: 760мс после закрытия, 1150мс после промаха */
    return true;
  }
};

/* «Доббль» — игра без очереди: жмут оба сразу, и порядок решает сервер.
   Здесь у плохой связи своя цена: заявка, которая пришла второй, не должна
   ни пропасть без следа, ни забрать карту у того, кто успел раньше. */
const dobble = {
  file: 'dobble.html',
  title: 'Доббль',
  free: true,
  look: (p) => p.evaluate(() => {
    const syms = (sel) => [].map.call(document.querySelectorAll(sel + ' .sy'), g => g.dataset.s).sort().join(',');
    return {
      playing: document.getElementById('app').classList.contains('playing'),
      seat: window.NET ? NET.seat : 0,
      ready: !document.getElementById('cMid').classList.contains('back'),
      mid: syms('#cMid'), mine: syms('#cBot'), theirs: syms('#cTop'),
      me: document.getElementById('numBot').textContent,
      opp: document.getElementById('numTop').textContent,
      over: document.getElementById('sheet').classList.contains('on')
    };
  }),
  /* у обоих экранов своя сторона — сравниваем, приведя к месту первого */
  view: (s) => [s.mid, s.seat === 2 ? s.theirs : s.mine,
                s.seat === 2 ? s.opp + ':' + s.me : s.me + ':' + s.opp].join('|'),
  /* «ход» в этой игре — обе стороны хватают одну и ту же карту разом */
  async both(A, B){
    const grab = (p) => p.evaluate(() => {
      const set = (sel) => [].map.call(document.querySelectorAll(sel + ' .sy'), g => +g.dataset.s);
      const mid = set('#cMid');
      const s = set('#cBot').filter(x => mid.indexOf(x) > -1)[0];
      if (s === undefined) return false;
      const g = document.querySelector('#cBot .sy[data-s="' + s + '"]');
      const r = g.getBoundingClientRect();
      document.getElementById('cBot').dispatchEvent(new PointerEvent('pointerdown', {
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true }));
      return true;
    });
    const out = await Promise.all([grab(A), grab(B)]);
    await wait(1400);
    return out[0] || out[1];
  }
};

/* «Взломщик кода» — единственная игра, где раунд начинается не с хода, а с
   обмена кодами: оба запирают свой замок и шлют код отдельным ходом, причём
   первым обязан сходить начинающий. На рвущейся связи это и есть самое
   тонкое место: заявка с кодом может потеряться, прийти дважды или опоздать
   на целый ход — а раунд после этого обязан идти как ни в чём не бывало. */
const vzlomshik = {
  file: 'vzlomshik.html',
  title: 'Взломщик кода',
  look: (p) => p.evaluate(() => ({
    playing: document.getElementById('app').classList.contains('playing'),
    seat: window.NET ? NET.seat : 0,
    act: document.getElementById('act').textContent.trim(),
    can: !document.getElementById('act').disabled,
    rows: [].map.call(document.querySelectorAll('#log .entry .dg'),
                      (d) => [].map.call(d.querySelectorAll('b'), (b) => b.textContent).join('')).join(','),
    s1: document.getElementById('score1').textContent,
    s2: document.getElementById('score2').textContent,
    over: document.getElementById('sheet').classList.contains('on')
  })),
  /* Журнал показывает попытки того, чей сейчас ход, — он одинаков на обоих
     экранах. Свой замок у каждого свой, поэтому в сверку он не идёт. */
  view: (s) => [s.s1 + ':' + s.s2, s.rows, s.over ? 'итог' : 'идёт'].join('|'),
  mine: (s) => s.can && (s.act === 'Запереть замок' || s.act === 'Проверить код'),
  /* кнопка оживает не сразу: диски докручиваются, и до конца анимации
     игра никаких нажатий не принимает */
  async till(page, fn, ms){
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 9000)){
      if (fn(await vzlomshik.look(page))) return true;
      await wait(150);
    }
    return false;
  },
  ready(page, ms){ return vzlomshik.till(page, (s) => s.can, ms); },
  async move(page, step){
    const before = await vzlomshik.look(page);
    if (before.act === 'Запереть замок'){
      await page.locator('#dice').click();            /* случайный код — своим замком */
      if (!await vzlomshik.ready(page)) return false;
      await page.locator('#act').click({ force: true });
      /* замок запирается не мгновенно: диски ещё разбегаются, пряча код */
      return await vzlomshik.till(page, (s) => s.act !== 'Запереть замок', 9000);
    }
    /* попытка: каждую цифру ставим на свой диск — так не уедет набор,
       если клавиша придётся на анимацию */
    const code = ('000' + ((step * 1117 + 293) % 10000)).slice(-4);
    for (let i = 0; i < 4; i++){
      if (!await vzlomshik.ready(page)) return false;
      await page.locator('#lock .wheel').nth(i).focus();
      await page.keyboard.press(code[i]);
      await wait(110);
    }
    if (!await vzlomshik.ready(page)) return false;
    await page.locator('#act').click({ force: true });
    return await vzlomshik.till(page, (s) => s.rows !== before.rows || s.over, 12000);
  }
};

/* ───────── сама проверка ───────── */

async function play(game){
  rep.head(game.title + ' — партия на рвущейся связи');
  const A = await tab(browser, rep, 'A');
  const B = await tab(browser, rep, 'B');
  const rebuilt = { A: 0, B: 0 };
  A.on('console', m => { if (m.text().indexOf('[net] пересборка раунда') === 0) rebuilt.A++; });
  B.on('console', m => { if (m.text().indexOf('[net] пересборка раунда') === 0) rebuilt.B++; });
  await probe(A); await probe(B);
  await A.goto(BASE + game.file);
  await B.goto(BASE + game.file);
  await lobby.openFrom(A, '.row[data-mode="3"]');
  const code = await lobby.create(A);
  await lobby.openFrom(B, '.row[data-mode="3"]');
  await lobby.join(B, code);
  ok(game.title + ': оба в игре', await until(B, game.look, s => s.playing) &&
                                  await until(A, game.look, s => s.playing));
  /* связь портим только одному: так виднее, кто именно поехал */
  await flaky(B, { lose: 0.08, deaf: 0.1, late: 0.12, slow: 0.15, hold: 1000,
                   seed: Number(process.env.SEED || 5) });

  /* Сходятся ли стороны и стоит ли поле, когда никто не нажимает.
     Плохой связи даём время: важно не «мгновенно одинаково», а «сошлись и
     стоят». Не сошлись за это время или поле само по себе меняется —
     это и есть та самая беда. */
  const view = game.view || ((s) => [s.shut, s.up, s.won, s.score].join('|'));
  async function settle(ms){
    const t0 = Date.now();
    let a = null, b = null, still = 0;
    while (Date.now() - t0 < (ms || 40000)){
      await wait(900);
      const na = await game.look(A), nb = await game.look(B);
      if (a && view(na) === view(a) && view(nb) === view(b) && view(na) === view(nb)){
        if (++still >= 3) return null;               /* три раза подряд одно и то же у обоих */
      } else still = 0;
      a = na; b = nb;
    }
    /* не сошлись за отведённое время: либо поля разные и стоят, либо
       что-то само по себе меняется, хотя никто не нажимает */
    return { беда: view(a) === view(b) ? 'поле само меняется' : 'поля разъехались', a, b };
  }

  let moves = 0, stuck = 0, trouble = null, rounds = 0, darkDone = false;
  for (let step = 0; step < 26 && !trouble; step++){
    const sa = await game.look(A), sb = await game.look(B);
    if (game.free){
      /* без очереди: ждём, пока обе стороны готовы, и хватаем карту вдвоём */
      if (!sa.ready || !sb.ready){ await wait(700); continue; }
      if (sa.over && sb.over) break;
      /* соперник пропадает из сети ровно на одну хватку */
      const dark = !darkDone && moves >= 3;
      if (dark){ darkDone = true; blackout(B, 9000); await wait(400); }
      if (!(await game.both(A, B))) break;
      moves++;
      if (dark){ await wait(6000); trouble = await settle(45000);
        ok(game.title + ': соперник пропал из сети — вернулся и всё сошлось', !trouble, trouble);
        if (trouble) break; }
      else if (step % 4 === 3) trouble = await settle(30000);
      continue;
    }
    if (sa.over && sb.over){                        /* раунд доигран — зовём реванш */
      rounds++;
      if (rounds >= 2) break;
      await A.locator('#again').click({ force: true });
      await B.locator('#again').click({ force: true });
      await wait(2500);
      continue;
    }
    const who = game.mine(sa) ? A : (game.mine(sb) ? B : null);
    if (!who){ stuck++; if (stuck > 14) break; await wait(800); continue; }
    stuck = 0;
    /* Один раз за партию уводим второго игрока из сети на весь чужой ход:
       вернувшись, он получит пачку ходов и чужую очередь одним ответом. */
    const dark = !darkDone && who === A && moves >= 3;
    if (dark){ darkDone = true; blackout(B, 9000); await wait(500); }
    if (!(await game.move(who, step))) break;
    moves++;
    if (dark){
      await wait(6000);
      trouble = await settle(45000);
      ok(game.title + ': соперник пропал из сети на ход — вернулся и всё сошлось', !trouble, trouble);
      if (trouble) break;
    }
    if (step % 4 === 3) trouble = await settle(30000);
  }
  if (!trouble) trouble = await settle(45000);
  ok(game.title + ': стороны сходятся и поле стоит, пока никто не нажимает', !trouble, trouble);
  ok(game.title + ': партия действительно шла', moves >= 6, moves);
  /* Пересборка раунда — лекарство, а не норма: игрок видит, как поле
     собирается заново. На рвущейся связи одна-две ещё простительны. */
  ok(game.title + ': поле не пересобирается раз за разом', rebuilt.A + rebuilt.B <= 2, rebuilt);

  /* полный список ходов раунда, как его видит сервер — чтобы было с чем
     сверять то, что разыграла у себя каждая сторона */
  const serverList = (page) => page.evaluate(async () => {
    try {
      const r = await fetch('/api/state', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: NET.code, token: NET.token, since: 0 }) });
      const j = await r.json();
      return { total: j.total, round: j.round, turn: j.turn, moves: j.moves };
    } catch(e){ return { error: String(e) }; }
  });
  if (trouble) console.log('     список ходов на сервере: ' + JSON.stringify(await serverList(A)));

  const ra = await api(A), rb = await api(B);
  judge(rep, game.title + ', связь целая', ra, moves * 2);
  judge(rep, game.title + ', связь рвётся', rb, moves * 2);
  if (trouble || process.env.TRACE){
    const trace = (label, recs) => {
      console.log('     ── ' + label + ', последние запросы ──');
      recs.filter(r => r.action === 'move').slice(-16).forEach(function(r){
        console.log('       ' + [r.action, 'since=' + r.since,
          r.sent === undefined ? '' : 'ход=' + JSON.stringify(r.sent) + ' метка=' + r.mid, '→', r.status,
          r.total === undefined ? '' : 'всего=' + r.total, r.got ? 'отдал=' + r.got : '',
          r.round === undefined ? '' : 'раунд=' + r.round, r.turn ? 'очередь=' + r.turn : ''].join(' '));
      });
    };
    trace('A', ra); trace('B', rb);
  }
  await A.context().close();
  await B.context().close();
}

if (!process.env.ONLY || process.env.ONLY==='memo') await play(memo);
if (!process.env.ONLY || process.env.ONLY==='yaschik') await play(yaschik);
if (!process.env.ONLY || process.env.ONLY==='dobble') await play(dobble);
if (!process.env.ONLY || process.env.ONLY==='vzlomshik') await play(vzlomshik);

await browser.close();
process.exit(rep.done('Долгая партия'));
