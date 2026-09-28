/* Сетевая партия в «Точки и квадраты»: главное здесь — бонусный ход.
   Замкнул квадрат — ходишь снова, и сервер обязан это принять. */
import { BASE, wait, reporter, launch, tab, lobby, until } from './netkit.mjs';

const URL = BASE + 'dots-boxes.html';
const rep = reporter();
const ok = rep.ok;

const look = (page) => page.evaluate(() => ({
  screen: document.getElementById('app').classList.contains('playing') ? 'игра' : 'меню',
  net: document.body.classList.contains('playing-net'),
  name1: document.getElementById('name1').textContent.trim(),
  name2: document.getElementById('name2').textContent.trim(),
  s1: document.getElementById('score1').textContent,
  s2: document.getElementById('score2').textContent,
  hint: document.getElementById('hint').textContent.trim(),
  taken: document.querySelectorAll('.edge[disabled]').length,
  boxes: document.querySelectorAll('.boxtile.on').length,
  sheet: document.getElementById('sheet').classList.contains('on'),
  sheetTitle: document.getElementById('sheetTitle').textContent,
  forfeit: document.getElementById('forfeit').classList.contains('on'),
  again: document.getElementById('again').textContent,
  againOff: document.getElementById('again').disabled
}));

/* чей сейчас ход по мнению этой страницы */
const whose = (page) => page.evaluate(() => (window.__t ? 0 : 0) ||
  (document.querySelector('#slider').style.transform.indexOf('100') >= 0 ? 2 : 1));
/* первое свободное ребро — кликаем напрямую, все проверки игра делает сама */
const tapFree = (page) => page.evaluate(() => {
  const free = [].slice.call(document.querySelectorAll('.edge')).filter(e => !e.disabled);
  if (!free.length) return false;
  free[0].click();
  return true;
});
const taken = (page, n, ms) => until(page, look, s => s.taken === n, ms || 9000);

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
ok('у первого «Вы» слева', a0.name1 === 'Вы' && a0.name2 === 'Соперник', [a0.name1, a0.name2]);
ok('у второго «Вы» справа', b0.name1 === 'Соперник' && b0.name2 === 'Вы', [b0.name1, b0.name2]);
ok('второй ждёт', b0.hint === 'Ход соперника', b0.hint);
ok('кнопка «заново» спрятана', await A.locator('#reset').isHidden());

rep.head('блокировка');
await tapFree(B);
await wait(900);
ok('чужой ход не проходит', (await look(B)).taken === 0);

rep.head('партия до конца');
/* ходит тот, чья очередь; бонусные ходы считаем отдельно */
let extra = 0, prev = 0, guard = 0;
while (guard++ < 60){
  const st = await look(A);
  if (st.sheet) break;
  const who = await whose(A);
  const p = who === 1 ? A : B;
  if (who === prev) extra++;
  prev = who;
  const moved = await tapFree(p);
  if (!moved) break;
  const n = st.taken + 1;
  if (!(await taken(p, n)) || !(await taken(p === A ? B : A, n))){
    ok('ходы синхронны на ' + n + '-м ребре', false);
    break;
  }
}
ok('партия доиграна', (await look(A)).taken === 40, (await look(A)).taken);
ok('бонусные ходы случались', extra > 0, extra);

const a1 = await look(A), b1 = await look(B);
ok('поле у обоих одинаковое', a1.taken === b1.taken && a1.boxes === b1.boxes, [a1.taken, b1.taken, a1.boxes, b1.boxes]);
ok('все квадраты заняты', a1.boxes === 16, a1.boxes);
ok('счёт сошёлся', a1.s1 === b1.s1 && a1.s2 === b1.s2, [a1.s1, a1.s2, b1.s1, b1.s2]);
ok('сумма счёта равна числу квадратов', (+a1.s1) + (+a1.s2) === 16, [a1.s1, a1.s2]);

rep.head('итог');
ok('шторка у первого', await until(A, look, s => s.sheet));
ok('шторка у второго', await until(B, look, s => s.sheet));
await wait(600);                      /* дадим обеим шторкам дорисоваться */
const af = await look(A), bf = await look(B);
const titles = [af.sheetTitle, bf.sheetTitle];
ok('итоги согласованы',
   (af.sheetTitle === 'Ничья' && bf.sheetTitle === 'Ничья') ||
   (af.sheetTitle === 'Вы выиграли' && bf.sheetTitle === 'Соперник выиграл') ||
   (af.sheetTitle === 'Соперник выиграл' && bf.sheetTitle === 'Вы выиграли'), titles);
if (af.sheetTitle !== 'Ничья'){
  const loser = af.sheetTitle === 'Соперник выиграл' ? af : bf;
  const winner = af.sheetTitle === 'Вы выиграли' ? af : bf;
  ok('фант только проигравшему', loser.forfeit === true && winner.forfeit === false,
     [loser.forfeit, winner.forfeit]);
} else {
  ok('при ничьей фанта нет', af.forfeit === false && bf.forfeit === false, [af.forfeit, bf.forfeit]);
}

rep.head('реванш');
await A.locator('#again').click();
ok('первый ждёт согласия', await until(A, look, s => s.againOff && /Ждём соперника/.test(s.again)));
ok('второму видно, что готов', await until(B, look, s => /Соперник готов/.test(s.again)));
await B.locator('#again').click();
ok('поле у первого чистое', await taken(A, 0));
ok('поле у второго чистое', await taken(B, 0));
const a2 = await look(A), b2 = await look(B);
ok('шторки закрылись', !a2.sheet && !b2.sheet);
ok('во втором раунде начинает второй', a2.hint === 'Ход соперника' && b2.hint !== 'Ход соперника', [a2.hint, b2.hint]);

rep.head('обрыв связи');
await B.locator('#toMenu').click();
ok('первого предупредили', await until(A, lobby.warned, w => w.shown && /вышел/.test(w.text), 12000));

await browser.close();
process.exit(rep.done('Точки и квадраты'));
