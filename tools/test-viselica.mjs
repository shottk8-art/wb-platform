/* Сетевая партия в «Быструю виселицу» — игра асимметричная:
   один загадывает слово за 30 секунд, второй отгадывает.
   По сети слово не видно сопернику на экране — это её главный выигрыш. */
import { BASE, wait, reporter, launch, tab, lobby, until } from './netkit.mjs';

const URL = BASE + 'viselica.html';
const rep = reporter();
const ok = rep.ok;

const look = (page) => page.evaluate(() => ({
  screen: document.getElementById('app').classList.contains('playing') ? 'игра' : 'меню',
  net: document.body.classList.contains('playing-net'),
  setting: document.getElementById('game').classList.contains('setting'),
  who: (document.getElementById('who') || {}).textContent || '',
  hint: document.getElementById('hint').textContent.trim(),
  entry: [].slice.call(document.querySelectorAll('#erow .tile')).map(t => t.textContent).join(''),
  word: [].slice.call(document.querySelectorAll('#wrow .tile')).map(t => t.textContent || '_').join(''),
  slots: document.querySelectorAll('#wrow .tile').length,
  wrong: document.querySelectorAll('#kbd .key.absent').length,
  right: document.querySelectorAll('#kbd .key.correct').length,
  s1: document.getElementById('score1').textContent,
  s2: document.getElementById('score2').textContent,
  sheet: document.getElementById('sheet').classList.contains('on'),
  sheetTitle: document.getElementById('sheetTitle').textContent,
  sheetSub: document.getElementById('sheetSub').textContent,
  forfeit: document.getElementById('forfeit').classList.contains('on'),
  ftext: document.getElementById('ftext').textContent,
  n1: document.getElementById('name1').textContent,
  n2: document.getElementById('name2').textContent,
  again: document.getElementById('again').textContent,
  againOff: document.getElementById('again').disabled
}));

const key = (page, k) => page.evaluate(c => {
  const b = document.querySelector('#kbd .key[data-k="' + c + '"]');
  if (!b) return false;
  b.click();
  return true;
}, k);
const type = async (page, w) => { for (const c of w) await key(page, c); };

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

rep.head('роли');
await wait(800);
const a0 = await look(A), b0 = await look(B);
ok('оба на экране загадывания', a0.setting && b0.setting, [a0.setting, b0.setting]);
ok('первому сказано загадывать', /Загадайте слово/.test(a0.who), a0.who);
ok('второму сказано ждать', /Соперник загадывает/.test(b0.who), b0.who);

rep.head('слово набирает только загадывающий');
await type(B, 'дом');
await wait(600);
ok('отгадывающий набрать не может', (await look(B)).entry === '', (await look(B)).entry);
await type(A, 'парус');
ok('загадывающий набрал', await until(A, look, s => s.entry === 'парус', 6000), (await look(A)).entry);
ok('сопернику букв не видно', (await look(B)).entry === '', (await look(B)).entry);

rep.head('слово уходит в сеть');
await key(A, 'ENTER');
ok('первый перешёл к отгадыванию', await until(A, look, s => !s.setting, 8000));
ok('второй тоже', await until(B, look, s => !s.setting, 10000));
const a1 = await look(A), b1 = await look(B);
ok('клеток столько же, сколько букв', a1.slots === 5 && b1.slots === 5, [a1.slots, b1.slots]);
ok('слово скрыто у обоих', !/парус/i.test(a1.word) && !/парус/i.test(b1.word), [a1.word, b1.word]);
ok('второму сказано отгадывать', /Ваш ход/.test(b1.hint), b1.hint);
ok('первому — что отгадывает соперник', /соперник/i.test(a1.hint), a1.hint);

rep.head('буквы летят к загадавшему');
await key(A, 'о');
await wait(700);
ok('загадавший не может подсказывать', (await look(A)).wrong + (await look(A)).right === 0);

await key(B, 'п');
ok('верная буква встала у отгадывающего', await until(B, look, s => s.right === 1, 8000), (await look(B)).right);
ok('и у загадавшего тоже', await until(A, look, s => s.right === 1, 9000), (await look(A)).right);
ok('буква видна в слове', /п/.test((await look(A)).word), (await look(A)).word);

await key(B, 'ж');
ok('ошибка учтена у отгадывающего', await until(B, look, s => s.wrong === 1, 8000), (await look(B)).wrong);
ok('и у загадавшего тоже', await until(A, look, s => s.wrong === 1, 9000), (await look(A)).wrong);

rep.head('партия до конца');
for (const c of ['а', 'р', 'у', 'с']) { await key(B, c); await wait(900); }
ok('слово отгадано — шторка у второго', await until(B, look, s => s.sheet, 10000));
ok('шторка у первого', await until(A, look, s => s.sheet, 10000));
await wait(700);
const a2 = await look(A), b2 = await look(B);
ok('второй отгадал', /Вы отгадали слово/.test(b2.sheetTitle), b2.sheetTitle);
ok('первому сказано, что отгадал соперник', /Соперник отгадал слово/.test(a2.sheetTitle), a2.sheetTitle);
ok('слово показано в итоге', /ПАРУС/.test(a2.sheetSub) && /ПАРУС/.test(b2.sheetSub), [a2.sheetSub, b2.sheetSub]);
ok('счёт сошёлся', a2.s1 === b2.s1 && a2.s2 === b2.s2, [a2.s1, a2.s2, b2.s1, b2.s2]);
ok('фант только проигравшему', a2.forfeit === true && b2.forfeit === false, [a2.forfeit, b2.forfeit]);
ok('фант в форме «Вы …»', /^Вы /.test(a2.ftext), a2.ftext);
ok('подписи сторон личные у первого', a2.n1 === 'Вы' && a2.n2 === 'Соперник', [a2.n1, a2.n2]);
ok('подписи сторон личные у второго', b2.n1 === 'Соперник' && b2.n2 === 'Вы', [b2.n1, b2.n2]);

rep.head('реванш меняет роли');
await A.locator('#again').click();
ok('первый ждёт согласия', await until(A, look, s => s.againOff && /Ждём соперника/.test(s.again)));
await B.locator('#again').click();
ok('снова экран загадывания', await until(A, look, s => s.setting && !s.sheet, 10000));
await wait(700);
const a3 = await look(A), b3 = await look(B);
ok('теперь загадывает второй', /Соперник загадывает/.test(a3.who) && /Загадайте слово/.test(b3.who), [a3.who, b3.who]);

rep.head('обрыв связи');
await B.locator('#toMenu').click();
ok('первого предупредили', await until(A, lobby.warned, w => w.shown && /вышел/.test(w.text), 14000));

await browser.close();
process.exit(rep.done('Быстрая виселица'));
