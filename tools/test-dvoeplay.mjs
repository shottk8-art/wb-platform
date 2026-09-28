/* Настоящая сетевая партия в «4 в ряд»: два окна, живой сервер, реальные клики. */
import { BASE, wait, reporter, launch, tab, lobby, until, tapAt } from './netkit.mjs';

const URL = BASE + 'dvoeplay.html';
const rep = reporter();
const ok = rep.ok;

const look = (page) => page.evaluate(() => ({
  screen: document.body.classList.contains('playing') ? 'игра' : 'меню',
  net: document.body.classList.contains('playing-net'),
  openSheet: document.body.classList.contains('open'),
  name1: document.getElementById('name1').textContent.trim(),
  name2: document.getElementById('name2').textContent.trim(),
  dots1: !!document.querySelector('#name1 .dots'),
  dots2: !!document.querySelector('#name2 .dots'),
  score: document.getElementById('score1').textContent + ':' + document.getElementById('score2').textContent,
  hint: document.getElementById('hint').textContent.trim(),
  discs: document.querySelectorAll('.board .disc:not(.aim)').length,
  sheetTitle: document.getElementById('sheetTitle').textContent,
  forfeit: document.getElementById('forfeit').classList.contains('on'),
  ftext: document.getElementById('ftext').textContent,
  again: document.getElementById('again').textContent,
  againOff: document.getElementById('again').disabled
}));

const drop = (page, col) => tapAt(page, '#board', (col + 0.5) / 7, 0.5);
const discs = (page, n, ms) => until(page, look, s => s.discs === n, ms || 7000);

const browser = await launch();
const A = await tab(browser, rep, 'A');
const B = await tab(browser, rep, 'B');

rep.head('комната');
await A.goto(URL);
await B.goto(URL);
await lobby.openFrom(A, '.row[data-mode="3"]');
ok('лобби открылось', await lobby.open(A));
const code = await lobby.create(A);
ok('код получен: ' + code, /^\d{5}$/.test(code));
ok('пока ждём — в игру не пускает', (await look(A)).screen === 'меню');

await lobby.openFrom(B, '.row[data-mode="3"]');
await lobby.join(B, code);
ok('второй вошёл в игру', await until(B, look, s => s.screen === 'игра' && s.net));
ok('первый тоже в игре', await until(A, look, s => s.screen === 'игра' && s.net));
ok('лобби закрылось у обоих', !(await lobby.open(A)) && !(await lobby.open(B)));

const a0 = await look(A), b0 = await look(B);
ok('у первого «Вы» слева', a0.name1 === 'Вы' && a0.name2 === 'Соперник', [a0.name1, a0.name2]);
ok('у второго «Вы» справа', b0.name1 === 'Соперник' && b0.name2 === 'Вы', [b0.name1, b0.name2]);
ok('первый ходит', a0.hint === 'Ваш ход', a0.hint);
ok('второй ждёт', b0.hint === 'Ход соперника', b0.hint);
ok('точка ожидания у ходящего', b0.dots1 === true && b0.dots2 === false, [b0.dots1, b0.dots2]);
ok('кнопка «заново» спрятана', await A.locator('#reset').isHidden());
ok('предупреждения о связи нет', !(await lobby.warned(A)).shown);

rep.head('блокировка');
await drop(B, 0);
await wait(900);
ok('чужой ход не проходит', (await look(B)).discs === 0);

rep.head('партия');
const plan = [[A,0],[B,6],[A,1],[B,6],[A,2],[B,6],[A,3]];
for (let i = 0; i < plan.length; i++){
  const [p, col] = plan[i];
  await drop(p, col);
  ok('ход ' + (i+1) + ' виден у себя', await discs(p, i + 1));
  ok('ход ' + (i+1) + ' долетел до соперника', await discs(p === A ? B : A, i + 1));
}

rep.head('итог');
ok('у первого «Вы выиграли»', await until(A, look, s => s.openSheet && s.sheetTitle === 'Вы выиграли'));
ok('у второго «Выиграл соперник»', await until(B, look, s => s.openSheet && s.sheetTitle === 'Выиграл соперник'));
const a1 = await look(A), b1 = await look(B);
ok('счёт совпал', a1.score === '1:0' && b1.score === '1:0', [a1.score, b1.score]);
ok('победителю фанта нет', a1.forfeit === false);
ok('проигравшему фант есть', b1.forfeit === true);
ok('фант в форме «Вы …»', /^Вы /.test(b1.ftext), b1.ftext);

rep.head('реванш');
await A.locator('#again').click();
ok('первый ждёт согласия', await until(A, look, s => s.againOff && /Ждём соперника/.test(s.again)));
ok('второму видно, что готов', await until(B, look, s => /Соперник готов/.test(s.again)));
await B.locator('#again').click();
ok('поле у первого чистое', await discs(A, 0));
ok('поле у второго чистое', await discs(B, 0));
const a2 = await look(A), b2 = await look(B);
ok('шторки закрылись', !a2.openSheet && !b2.openSheet);
ok('счёт сохранился', a2.score === '1:0' && b2.score === '1:0', [a2.score, b2.score]);
ok('во втором раунде начинает второй', a2.hint === 'Ход соперника' && b2.hint === 'Ваш ход', [a2.hint, b2.hint]);
ok('кнопка «играть снова» вернулась', a2.again === 'Играть снова' && !a2.againOff, a2.again);

await drop(A, 0);
await wait(700);
ok('первый не ходит в чужую очередь', (await look(A)).discs === 0);
await drop(B, 3);
ok('второй сходил', await discs(B, 1));
ok('ход дошёл до первого', await discs(A, 1));

rep.head('обрыв связи');
await B.locator('#back').click();
ok('первого предупредили', await until(A, lobby.warned, w => w.shown && /вышел/.test(w.text), 12000));

rep.head('приглашение по ссылке');
const C = await tab(browser, rep, 'C');
await A.locator('#back').click();
await wait(400);
await lobby.openFrom(A, '.row[data-mode="3"]');
const code2 = await lobby.create(A, code);
ok('вторая комната — новый код', code2 !== code, [code, code2]);
await C.goto(URL + '?room=' + code2);
ok('по ссылке сразу в партию', await until(C, look, s => s.screen === 'игра' && s.net));
ok('у хозяина комнаты тоже началась', await until(A, look, s => s.screen === 'игра'));
ok('адрес почищен от кода', !(await C.evaluate(() => location.search)));

rep.head('чужой код');
await C.locator('#back').click();
await A.locator('#back').click();
await wait(300);
await lobby.openFrom(C, '.row[data-mode="3"]');
await lobby.join(C, '00042');
ok('нет такой комнаты — сказали', await until(C, lobby.msg, m => /не найдена/i.test(m || ''), 7000));

await browser.close();
process.exit(rep.done('4 в ряд'));
