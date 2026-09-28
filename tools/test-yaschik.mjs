/* Сетевая партия в «Захлопни ящик». Главное испытание — кубики:
   бросок обязан совпасть у обоих, иначе игра разъедется. */
import { BASE, wait, reporter, launch, tab, lobby, until } from './netkit.mjs';

const URL = BASE + 'zahlopni-yaschik.html';
const rep = reporter();
const ok = rep.ok;

const look = (page) => page.evaluate(() => {
  const face = (id) => {
    const el = document.getElementById(id);
    if (!el) return '-';
    for (let v = 1; v <= 6; v++) if (el.classList.contains('v' + v)) return String(v);
    return '-';
  };
  return {
    screen: document.getElementById('app').classList.contains('playing') ? 'игра' : 'меню',
    net: document.body.classList.contains('playing-net'),
    hint: document.getElementById('hint').textContent.trim(),
    turn: document.getElementById('rack').classList.contains('p2') ? 2 : 1,
    dots1: !!document.querySelector('#nameA .dots, #name1 .dots'),
    dots2: !!document.querySelector('#nameB .dots, #name2 .dots'),
    s1: document.getElementById('score1').textContent,
    s2: document.getElementById('score2').textContent,
    dice: face('die1') + face('die2'),
    rolling: !!document.querySelector('#pit .die.throw'),
    shut: document.querySelectorAll('#rack .tile.shut').length,
    open: document.querySelectorAll('#rack .tile:not(.shut)').length,
    sheet: document.getElementById('sheet').classList.contains('on'),
    sheetTitle: document.getElementById('sheetTitle').textContent,
    again: document.getElementById('again').textContent,
    againOff: document.getElementById('again').disabled
  };
});

const roll = (page) => page.locator('#roll').click({ force: true });
const still = (page, ms) => until(page, look, s => !s.rolling, ms || 9000);
/* закрыть цифры на выпавшую сумму: игра сама проверит допустимость */
const closeFor = (page) => page.evaluate(() => {
  const tiles = [].slice.call(document.querySelectorAll('#rack .tile'));
  const open = [];
  tiles.forEach((t, i) => { if (!t.classList.contains('shut')) open.push(i + 1); });
  /* сумма берётся только из «Выпало N» — после промаха закрывать нечего */
  const m = /^Выпало (\d+)/.exec((document.getElementById('live').textContent || '').trim());
  const sum = m ? +m[1] : 0;
  if (!sum) return null;
  /* ищем любой набор открытых цифр, дающий эту сумму */
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

const browser = await launch();
const A = await tab(browser, rep, 'A');
const B = await tab(browser, rep, 'B');

rep.head('комната');
await A.goto(URL);
await B.goto(URL);
await lobby.openFrom(A, '.row[data-mode="3"]');
const code = await lobby.create(A);
ok('код получен: ' + code, /^\d{5}$/.test(code));
await lobby.openFrom(B, '.row[data-mode="3"]');
await lobby.join(B, code);
ok('второй в игре', await until(B, look, s => s.screen === 'игра' && s.net));
ok('первый в игре', await until(A, look, s => s.screen === 'игра' && s.net));

const a0 = await look(A), b0 = await look(B);
ok('все двенадцать цифр открыты', a0.open === 12 && b0.open === 12, [a0.open, b0.open]);
ok('первый ходит', a0.turn === 1, a0.turn);
ok('и второй видит то же самое', b0.turn === 1, b0.turn);
ok('ожидающему сказано, что ход чужой', /Ход соперника/.test(b0.hint), b0.hint);
ok('ходящему не сказано ждать', !/Ход соперника/.test(a0.hint), a0.hint);
ok('точка ожидания у ходящего', b0.dots1 && !b0.dots2, [b0.dots1, b0.dots2]);

rep.head('блокировка');
const bBefore = (await look(B)).dice;
await roll(B);
await wait(1400);
ok('чужой бросок не проходит', (await look(B)).dice === bBefore && !(await look(B)).rolling,
   [(await look(B)).dice, bBefore]);

rep.head('кубики совпадают');
await roll(A);
ok('у первого кубики остановились', await still(A, 12000));
ok('у второго кубики тоже бросились', await until(B, look, s => s.dice !== b0.dice, 12000));
ok('у второго остановились', await still(B, 12000));
const a1 = await look(A), b1 = await look(B);
ok('выпало одно и то же: ' + a1.dice, a1.dice === b1.dice, [a1.dice, b1.dice]);

rep.head('закрытие цифр');
/* ходим по-настоящему: чья очередь — тот бросает, а если есть что закрыть, закрывает */
let turnsDone = 0, rolls = 0, misses = 0;
/* Чей ход — спрашиваем у ОБОИХ: экран ждущего отстаёт на один опрос, и если
   довериться одному, тест начнёт жать «бросить» за того, кто уже не ходит. */
const agreedTurn = async () => {
  for (let i = 0; i < 60; i++){
    const a = await look(A), b = await look(B);
    if (a.sheet || b.sheet) return 0;
    if (a.turn === b.turn && !a.rolling && !b.rolling) return a.turn;
    await wait(200);
  }
  const a = await look(A), b = await look(B);
  console.log('     очередь так и не сошлась: A=' + JSON.stringify(a) + ' B=' + JSON.stringify(b));
  return 0;
};
for (let step = 0; step < 40; step++){
  const st = await look(A);
  if (st.sheet) break;
  const mover = await agreedTurn();
  if (!mover) break;
  const p = mover === 1 ? A : B;
  const q = mover === 1 ? B : A;
  await still(p, 12000); await still(q, 12000);

  const before = (await look(p)).shut;
  const picked = await closeFor(p);
  if (picked){
    const want = before + picked.length;
    const okSelf = await until(p, look, s => s.shut === want, 9000);
    const okPeer = await until(q, look, s => s.shut === want, 10000);
    if (!(okSelf && okPeer)){ ok('закрытие дошло до обоих на шаге ' + step, false, [okSelf, okPeer]); break; }
    turnsDone++;
    /* после закрытия ход передаётся не мгновенно — дождёмся, иначе бросок пропадёт */
    /* фоновая вкладка придерживает таймеры, поэтому ждём согласия ОБОИХ */
    if (!(await look(p)).sheet){
      await until(p, look, s => s.turn !== mover || s.sheet, 8000);
      await until(q, look, s => s.turn !== mover || s.sheet, 8000);
    }
    continue;
  }

  /* закрывать нечего — значит надо бросать */
  const was = (await look(q)).dice;
  await roll(p);
  await still(p, 12000);
  /* Ждём, пока бросок ДОЙДЁТ до второго: сравнивать кубики раньше нельзя —
     у него на экране ещё прошлый бросок, и тест ругался бы на пустом месте.
     Признак — он либо катит кубики, либо уже показывает то же, что первый. */
  const mine = (await look(p)).dice;
  await until(q, look, s => s.rolling || s.dice !== was || s.dice === mine || s.sheet, 12000);
  await still(q, 12000);
  /* партия закончилась прямо на этом броске — сравнивать кубики уже не с чем */
  if ((await look(p)).sheet || (await look(q)).sheet) break;
  rolls++;
  if (process.env.TRACE) console.log('     шаг ' + step + ' A=' +
    JSON.stringify(await A.evaluate(() => window.__z && window.__z())) + ' B=' +
    JSON.stringify(await B.evaluate(() => window.__z && window.__z())));
  const da = await look(A), db = await look(B);
  if (da.dice !== db.dice){ ok('кубики совпали на броске ' + rolls, false, [da.dice, db.dice]); break; }
  if (/Промах/.test(await p.evaluate(() => document.getElementById('live').textContent))){
    misses++;
    /* промах отдаёт ход сопернику, но не мгновенно: если не дождаться,
       следующий шаг будет бросать за того, кто уже не ходит, — бросок
       пропадёт, и партия так и не сдвинется */
    if (!(await look(p)).sheet){
      await until(p, look, s => s.turn !== mover || s.sheet, 8000);
      await until(q, look, s => s.turn !== mover || s.sheet, 8000);
    }
  }
}
ok('броски были и всегда совпадали', rolls >= 3, rolls);
ok('несколько ходов прошло', turnsDone >= 2, turnsDone);
if (process.env.TRACE) console.log('     закрытий ' + turnsDone + ', бросков ' + rolls + ', промахов ' + misses);
const a2 = await look(A), b2 = await look(B);
ok('поле совпало у обоих', a2.shut === b2.shut && a2.open === b2.open, [a2.shut, b2.shut]);
ok('счёт совпал', a2.s1 === b2.s1 && a2.s2 === b2.s2, [a2.s1, a2.s2, b2.s1, b2.s2]);
ok('цифры действительно закрывались', a2.shut > 0, a2.shut);

rep.head('обрыв связи');
/* партия могла и доиграться до конца — тогда поверх поля висит итоговая
   шторка, и выход из игры надо искать под ней */
if ((await look(B)).sheet){
  await B.locator('#look').click();
  await until(B, look, s => !s.sheet, 6000);
}
await B.locator('#toMenu').click();
ok('первого предупредили', await until(A, lobby.warned, w => w.shown && /вышел/.test(w.text), 14000));

await browser.close();
process.exit(rep.done('Захлопни ящик'));
