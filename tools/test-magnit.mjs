/* Сетевая партия в «Магнитный бой»: два окна, живой сервер, реальные жесты. */
import { BASE, wait, reporter, launch, tab, lobby, until } from './netkit.mjs';

const URL = BASE + 'magnitniy-boy.html';
const rep = reporter();
const ok = rep.ok;

const look = (page) => page.evaluate(() => ({
  screen: document.getElementById('app').classList.contains('playing') ? 'игра' : 'меню',
  net: document.body.classList.contains('playing-net'),
  name1: document.getElementById('nameA').textContent.trim(),
  name2: document.getElementById('nameB').textContent.trim(),
  hand1: document.getElementById('numA').textContent,
  hand2: document.getElementById('numB').textContent,
  hint: document.getElementById('hint').textContent.trim(),
  balls: document.querySelectorAll('#well .ball').length,
  sheet: document.getElementById('sheet').classList.contains('on'),
  sheetTitle: document.getElementById('sheetTitle').textContent,
  forfeit: document.getElementById('forfeit').classList.contains('on'),
  ftext: document.getElementById('ftext').textContent,
  again: document.getElementById('again').textContent,
  againOff: document.getElementById('again').disabled
}));

/* кладём магнит в долю (fx, fy) поля — как пальцем */
async function put(page, fx, fy){
  const b = await page.locator('#well').boundingBox();
  const x = b.x + b.width * fx, y = b.y + b.height * fy;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y);
  await page.mouse.up();
}
const balls = (page, n, ms) => until(page, look, s => s.balls === n, ms || 9000);
/* ход можно делать только когда анимация чужого закончилась и очередь наша */
const mine = (page, ms) => until(page, look, s => s.hint === 'Ваш ход', ms || 12000);

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
ok('первый ходит', a0.hint === 'Ваш ход', a0.hint);
ok('второй ждёт', b0.hint === 'Ход соперника', b0.hint);
ok('в руке по десять', a0.hand1 === '10' && a0.hand2 === '10', [a0.hand1, a0.hand2]);
ok('кнопка «заново» спрятана', await A.locator('#restart').isHidden());

rep.head('блокировка');
await put(B, 0.5, 0.5);
await wait(1000);
ok('чужой ход не проходит', (await look(B)).balls === 0);

rep.head('ходы');
/* кладём далеко друг от друга, чтобы магниты не слипались */
const spots = [[A,0.18,0.18],[B,0.82,0.18],[A,0.18,0.82],[B,0.82,0.82]];
for (let i = 0; i < spots.length; i++){
  const [p, fx, fy] = spots[i];
  ok('очередь дошла до игрока перед ходом ' + (i+1), await mine(p));
  await put(p, fx, fy);
  ok('ход ' + (i+1) + ' виден у себя', await balls(p, i + 1));
  ok('ход ' + (i+1) + ' долетел до соперника', await balls(p === A ? B : A, i + 1));
}
const a1 = await look(A), b1 = await look(B);
ok('счёт в руке сошёлся', a1.hand1 === '8' && a1.hand2 === '8', [a1.hand1, a1.hand2]);
ok('у обоих одинаково', a1.hand1 === b1.hand1 && a1.hand2 === b1.hand2);

rep.head('слипание синхронно');
await mine(A);
await put(A, 0.5, 0.48);       /* в центре пусто — просто ляжет */
await balls(A, 5); await balls(B, 5);
await mine(B);
await put(B, 0.53, 0.5);       /* вплотную к предыдущему — должно слипнуться */
ok('у второго шары ушли в руку', await until(B, look, s => s.balls === 4, 12000));
ok('у первого то же самое', await until(A, look, s => s.balls === 4, 12000));
const a2 = await look(A), b2 = await look(B);
ok('руки совпали после слипания', a2.hand1 === b2.hand1 && a2.hand2 === b2.hand2,
   [a2.hand1, a2.hand2, b2.hand1, b2.hand2]);

rep.head('обрыв связи');
await B.locator('#toMenuTop').click();
ok('первого предупредили', await until(A, lobby.warned, w => w.shown && /вышел/.test(w.text), 12000));

await browser.close();
process.exit(rep.done('Магнитный бой'));
