/* Сетевая партия в «Матрёшку»: два окна, живой сервер, реальные клики. */
import { BASE, wait, reporter, launch, tab, lobby, until } from './netkit.mjs';

const URL = BASE + 'matreshka.html';
const rep = reporter();
const ok = rep.ok;

const look = (page) => page.evaluate(() => ({
  screen: document.querySelector('.app').classList.contains('playing') ? 'игра' : 'меню',
  net: document.body.classList.contains('playing-net'),
  name1: document.getElementById('name1').textContent.trim(),
  name2: document.getElementById('name2').textContent.trim(),
  dots1: !!document.querySelector('#name1 .dots'),
  dots2: !!document.querySelector('#name2 .dots'),
  hand1: document.getElementById('score1').textContent,
  hand2: document.getElementById('score2').textContent,
  hint: document.getElementById('hint').textContent.trim(),
  pieces: document.querySelectorAll('#board .pc').length,
  sheet: document.getElementById('sheet').classList.contains('on'),
  sheetTitle: document.getElementById('sheetTitle').textContent,
  forfeit: document.getElementById('forfeit').classList.contains('on'),
  ftext: document.getElementById('ftext').textContent,
  again: document.getElementById('again').textContent,
  againOff: document.getElementById('again').disabled,
  win: document.querySelectorAll('#board .cell.win').length
}));

/* свой лоток всегда нижний: игра рисует «мои» фишки снизу */
async function put(page, size, cell){
  await page.locator('#trayBot .hp.h' + size).first().click();
  await page.locator('#board .cell').nth(cell).click();
}
const pieces = (page, n, ms) => until(page, look, s => s.pieces === n, ms || 7000);

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
ok('первому не ждать', a0.hint !== 'Ход соперника', a0.hint);
ok('второй ждёт', b0.hint === 'Ход соперника', b0.hint);
ok('точка ожидания у ходящего', b0.dots1 && !b0.dots2, [b0.dots1, b0.dots2]);
ok('в руке по шесть', a0.hand1 === '6' && a0.hand2 === '6', [a0.hand1, a0.hand2]);
ok('кнопка «заново» спрятана', await A.locator('#reset').isHidden());

rep.head('блокировка');
ok('лоток заперт, пока ход чужой',
   await B.evaluate(() => document.getElementById('trayBot').classList.contains('lock')));
await B.locator('#board .cell').nth(4).click({ force: true });
await wait(900);
ok('чужой ход не проходит', (await look(B)).pieces === 0);

rep.head('партия');
/* первый собирает верхний ряд 0–1–2, второй ставит в нижний, но не успевает */
const plan = [[A,3,0],[B,3,6],[A,3,1],[B,3,7],[A,2,2]];
for (let i = 0; i < plan.length; i++){
  const [p, size, cell] = plan[i];
  await put(p, size, cell);
  ok('ход ' + (i+1) + ' виден у себя', await pieces(p, i + 1));
  ok('ход ' + (i+1) + ' долетел до соперника', await pieces(p === A ? B : A, i + 1));
}

rep.head('итог');
ok('у первого «Вы выиграли»', await until(A, look, s => s.sheet && s.sheetTitle === 'Вы выиграли'));
ok('у второго «Соперник выиграл»', await until(B, look, s => s.sheet && s.sheetTitle === 'Соперник выиграл'));
const a1 = await look(A), b1 = await look(B);
ok('выигрышный ряд подсвечен у обоих', a1.win === 3 && b1.win === 3, [a1.win, b1.win]);
ok('победителю фанта нет', a1.forfeit === false);
ok('проигравшему фант есть', b1.forfeit === true);
ok('фант в форме «Вы …»', /^Вы /.test(b1.ftext), b1.ftext);

rep.head('реванш');
await A.locator('#again').click();
ok('первый ждёт согласия', await until(A, look, s => s.againOff && /Ждём соперника/.test(s.again)));
ok('второму видно, что готов', await until(B, look, s => /Соперник готов/.test(s.again)));
await B.locator('#again').click();
ok('поле у первого чистое', await pieces(A, 0));
ok('поле у второго чистое', await pieces(B, 0));
const a2 = await look(A), b2 = await look(B);
ok('шторки закрылись', !a2.sheet && !b2.sheet);
ok('руки полные', a2.hand1 === '6' && a2.hand2 === '6', [a2.hand1, a2.hand2]);
ok('во втором раунде начинает второй', a2.hint === 'Ход соперника' && b2.hint !== 'Ход соперника', [a2.hint, b2.hint]);
ok('кнопка вернулась', !a2.againOff);

await A.locator('#board .cell').nth(0).click({ force: true });
await wait(800);
ok('первый не ходит в чужую очередь', (await look(A)).pieces === 0);
await put(B, 1, 4);
ok('второй сходил', await pieces(B, 1));
ok('ход дошёл до первого', await pieces(A, 1));

rep.head('обрыв связи');
await B.locator('#toMenu').click();
ok('первого предупредили', await until(A, lobby.warned, w => w.shown && /вышел/.test(w.text), 12000));

await browser.close();
process.exit(rep.done('Матрёшка'));
