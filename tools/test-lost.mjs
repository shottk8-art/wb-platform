/* Обрыв связи посреди партии.
   На телефоне это обычное дело: лифт, метро, переключение с Wi-Fi на
   мобильную сеть. Раньше ход, попавший в такую секунду, применялся у себя
   и пропадал для соперника — партия расходилась навсегда. Теперь ход ждёт
   в очереди и уходит, как только связь вернётся. */
import { BASE, wait, reporter, launch, tab, lobby, until, tapAt } from './netkit.mjs';

const URL = BASE + 'dvoeplay.html';
const rep = reporter();
const ok = rep.ok;

const look = (page) => page.evaluate(() => ({
  screen: document.body.classList.contains('playing') ? 'игра' : 'меню',
  net: document.body.classList.contains('playing-net'),
  discs: document.querySelectorAll('.board .disc:not(.aim)').length,
  hint: document.getElementById('hint').textContent.trim()
}));
const drop = (page, col) => tapAt(page, '#board', (col + 0.5) / 7, 0.5);
const discs = (page, n, ms) => until(page, look, s => s.discs === n, ms || 8000);

const browser = await launch();
const A = await tab(browser, rep, 'A');
const B = await tab(browser, rep, 'B');

rep.head('комната');
await A.goto(URL);
await B.goto(URL);
await lobby.openFrom(A, '.row[data-mode="3"]');
const code = await lobby.create(A);
await lobby.openFrom(B, '.row[data-mode="3"]');
await lobby.join(B, code);
ok('оба в игре', await until(B, look, s => s.screen === 'игра' && s.net) &&
                 await until(A, look, s => s.screen === 'игра' && s.net));
/* шторка лобби ещё уезжает и ловит нажатия — дождёмся, пока уедет */
await until(A, p => p.evaluate(() => document.body.classList.contains('np-open')), v => !v, 5000);
await wait(700);

rep.head('обычный ход');
/* столбцы подобраны так, чтобы партия не кончилась раньше теста:
   первый ходит в 0-1-2, второй в 4-5-6, четырёх подряд ни у кого не выходит */
await drop(A, 0);
ok('ход виден у себя', await discs(A, 1));
ok('и у соперника', await discs(B, 1));
await drop(B, 4);
ok('ответный ход дошёл', await discs(A, 2) && await discs(B, 2));

rep.head('связь пропала');
/* рвём только отправку ходов: опрос оставляем, как в жизни бывает
   с полупроводной связью — что-то проходит, что-то нет */
await A.route('**/api/move', route => route.abort());
await drop(A, 1);
ok('у себя ход виден сразу', await discs(A, 3));
await wait(1800);
ok('до соперника он пока не дошёл', (await look(B)).discs === 2, (await look(B)).discs);
ok('игроку сказали про связь',
   await until(A, lobby.warned, w => w && w.shown && /связи с сервером/.test(w.text), 6000),
   await lobby.warned(A));

rep.head('связь вернулась');
await A.unroute('**/api/move');
ok('ход дошёл сам, без повторного нажатия', await discs(B, 3, 12000), (await look(B)).discs);
ok('пилюля погасла', await until(A, lobby.warned, w => w && !w.shown, 8000), await lobby.warned(A));
ok('ход не удвоился', (await look(A)).discs === 3 && (await look(B)).discs === 3,
   [(await look(A)).discs, (await look(B)).discs]);

rep.head('партия продолжается');
await drop(B, 5);
ok('следующий ход проходит как обычно', await discs(A, 4) && await discs(B, 4));
await drop(A, 2);
ok('и ещё один', await discs(A, 5) && await discs(B, 5));

rep.head('обрыв надолго');
await A.route('**/api/move', route => route.abort());
await drop(B, 6);                      /* соперник ходит, пока у нас нет связи */
ok('чужой ход доходит — опрос-то работает', await discs(A, 6));
await drop(A, 0);
await wait(4000);                      /* четыре секунды тишины */
await A.unroute('**/api/move');
ok('ход дождался своей минуты', await discs(B, 7, 14000), (await look(B)).discs);
ok('поле сошлось у обоих', (await look(A)).discs === 7 && (await look(B)).discs === 7,
   [(await look(A)).discs, (await look(B)).discs]);

rep.head('связь рвётся то и дело');
/* Самое похожее на жизнь: сеть не отваливается совсем, а теряет каждый
   третий запрос — и ходы, и опросы, у обоих игроков сразу. */
const flaky = (route) => (Math.random() < 0.35 ? route.abort() : route.continue());
await A.route('**/api/**', flaky);
await B.route('**/api/**', flaky);
let n = 7, held = 0;
for (const [who, col] of [[B, 4], [A, 1], [B, 5], [A, 2], [B, 6]]){
  const t0 = Date.now();
  await drop(who, col);
  n++;
  if (!(await discs(A, n, 25000) && await discs(B, n, 25000))){ held = n; break; }
  console.log('     ход ' + n + ' дошёл за ' + (Date.now() - t0) + 'мс');
}
ok('пять ходов прошли сквозь рваную связь', held === 0,
   held ? 'застряли на ходу ' + held : '');
await A.unroute('**/api/**');
await B.unroute('**/api/**');
await wait(2500);
const endA = await look(A), endB = await look(B);
ok('поле у обоих одинаковое', endA.discs === endB.discs && endA.discs === 12,
   [endA.discs, endB.discs]);
ok('очередь не разъехалась', endA.hint !== endB.hint, [endA.hint, endB.hint]);
ok('партия и не думала кончаться', !/Играть снова/.test(endA.hint), endA.hint);

await browser.close();
process.exit(rep.done('Обрыв связи'));
