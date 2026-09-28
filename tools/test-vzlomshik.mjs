/* Сетевая партия во «Взломщика кода» — десятая игра серии.

   Особенность этой игры: раунд начинается не с хода, а с обмена кодами.
   Оба запирают свой замок и шлют код сопернику отдельным ходом ['s','1234'],
   причём первым обязан сходить начинающий — иначе сервер отобьёт ход вне
   очереди. Значит главные испытания тут два:

   - запереть замки в «неудобном» порядке (первым запирает НЕ начинающий) и
     убедиться, что его код всё равно доедет — игра придержит заявку до
     прихода кода соперника (pendingSecret);
   - код соперника приходит по сети, но до конца раунда он не должен быть
     виден на экране нигде.

   Дальше — обычная проверка: подсказки считаются одинаково у обоих, за ход
   четыре попытки, потом очередь переходит, у догоняющего есть ответный ход,
   итог и счёт сходятся, реванш меняет начинающего. */
import { BASE, wait, reporter, launch, tab, lobby, until } from './netkit.mjs';

const URL = BASE + 'vzlomshik.html';
const rep = reporter();
const ok = rep.ok;

const look = (page) => page.evaluate(() => {
  const rows = [].map.call(document.querySelectorAll('#log .entry'), (r) => ({
    g: [].map.call(r.querySelectorAll('.dg b'), (b) => b.textContent).join(''),
    x: r.querySelectorAll('.peg.x').length,
    y: r.querySelectorAll('.peg.y').length
  }));
  return {
    screen: document.getElementById('app').classList.contains('playing') ? 'игра' : 'меню',
    net: document.body.classList.contains('playing-net'),
    seat: window.NET ? NET.seat : 0,
    act: document.getElementById('act').textContent.trim(),
    can: !document.getElementById('act').disabled,
    hint: document.getElementById('hint').textContent.trim(),
    whose: document.getElementById('whoseTxt').textContent.trim(),
    own: document.getElementById('lock').getAttribute('data-own'),
    open: document.getElementById('lock').classList.contains('open'),
    dials: [].map.call(document.querySelectorAll('#lock .wheel'), (w) => w.getAttribute('aria-valuenow')).join(''),
    rows: rows,
    used: document.querySelectorAll('#tries i.used').length,
    s1: document.getElementById('score1').textContent,
    s2: document.getElementById('score2').textContent,
    sheet: document.getElementById('sheet').classList.contains('on'),
    title: document.getElementById('sheetTitle').textContent,
    sub: document.getElementById('sheetSub').textContent,
    codes: [].map.call(document.querySelectorAll('#codes .code span'), (s) => s.textContent).join('/'),
    again: document.getElementById('again').textContent
  };
});

/* правильный ответ замка — им сверяем то, что игра показала точками */
function feedback(code, guess){
  let e = 0, n = 0;
  const cs = Array(10).fill(0), cg = Array(10).fill(0);
  for (let i = 0; i < 4; i++){
    if (code[i] === guess[i]) e++;
    else { cs[+code[i]]++; cg[+guess[i]]++; }
  }
  for (let i = 0; i < 10; i++) n += Math.min(cs[i], cg[i]);
  return { x: e, y: n };
}

/* То же, что until, но возвращает сам снимок. Нужно потому, что журнал
   живёт недолго: на четвёртой попытке ход тут же переходит к сопернику, и
   к моменту повторного взгляда строки уже сменились. Сверять надо ровно то
   состояние, которого дождались. */
async function grab(page, fn, ms = 12000){
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms){
    last = await look(page);
    if (fn(last)) return last;
    await wait(120);
  }
  console.log('     … не дождались, последнее состояние:', JSON.stringify(last));
  return null;
}

/* Тихое ожидание: без разбора неудач в журнале. Нужно там, где ждать
   приходится вперемешку с попытками — иначе вывод тонет в отчётах. */
async function quiet(page, fn, ms){
  const t0 = Date.now();
  while (Date.now() - t0 < ms){
    if (fn(await look(page))) return true;
    await wait(120);
  }
  return false;
}
/* Набрать код на дисках — с клавиатуры, ровно как это делает игрок.

   С клавиатуры цифры идут слева направо: игра сама переводит набор на
   следующий диск. Но если хоть одна клавиша пришлась на анимацию, она
   пропадает — и весь дальнейший набор уезжает на диск влево, причём
   повтор набора этого не исправляет: смещение сохраняется. Поэтому
   каждую цифру ставим на СВОЙ диск: сперва переводим на него фокус
   (игра запоминает, какой диск набирают), потом жмём клавишу и убеждаемся,
   что диск встал. */
async function setCode(page, code){
  if (!await quiet(page, (s) => s.can, 14000)) return false;
  await wait(300);
  for (let i = 0; i < code.length; i++){
    let done = false;
    for (let tryNo = 0; tryNo < 4 && !done; tryNo++){
      if (!await quiet(page, (s) => s.can, 8000)) break;
      await page.locator('#lock .wheel').nth(i).focus();
      await page.keyboard.press(code[i]);
      done = await quiet(page, (s) => s.dials.charAt(i) === code[i], 3500);
    }
    if (!done){
      console.log('     … диск ' + (i + 1) + ' не встал на ' + code[i] + ', на дисках ' + (await look(page)).dials);
      return false;
    }
  }
  return await quiet(page, (s) => s.dials === code && s.can, 5000);
}
const press = (page) => page.locator('#act').click();

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
ok('второй в игре', await until(B, look, (s) => s.screen === 'игра' && s.net));
ok('первый в игре', await until(A, look, (s) => s.screen === 'игра' && s.net));

/* кто начинает раунд, решает место: в нулевом раунде — первое */
const seatA = (await look(A)).seat, seatB = (await look(B)).seat;
ok('места разные', seatA !== seatB && seatA + seatB === 3, [seatA, seatB]);
const starter = seatA === 1 ? A : B;           /* начинающий — место 1 */
const other = starter === A ? B : A;
const CODE = new Map();                        /* какой замок кто запер */
CODE.set(starter, '1234');
CODE.set(other, '5678');

rep.head('оба запирают замок');
{
  const a = await look(A);
  ok('игра просит задать код', /Заприте замок|заприте замок/.test(a.hint), a.hint);
  ok('на кнопке «Запереть замок»', a.act === 'Запереть замок', a.act);
  ok('замок показан как свой', a.whose === 'Ваш замок', a.whose);
  ok('чужого кода на экране нет', a.codes === '', a.codes);
}
/* Нарочно «неудобный» порядок: первым запирает НЕ начинающий. Его код
   обязан подождать кода соперника и уйти следом, а не пропасть. */
ok('второй набрал свой код', await setCode(other, CODE.get(other)));
await press(other);
ok('он ждёт соперника', await until(other, look, (s) => /Ждём/.test(s.act), 8000), (await look(other)).act);
ok('кубик «случайный код» спрятан', await other.locator('#dice').isHidden());
await wait(700);
ok('пока второй ждёт, начинающий ещё не ходит',
   /Заприте замок|заприте замок/.test((await look(starter)).hint), (await look(starter)).hint);

ok('начинающий набрал свой код', await setCode(starter, CODE.get(starter)));
await press(starter);
ok('у начинающего начались попытки', await until(starter, look, (s) => s.act === 'Проверить код', 12000),
   (await look(starter)).act);
ok('и второй это увидел', await until(other, look, (s) => /подбирает код/.test(s.act), 12000),
   (await look(other)).act);
{
  const st = await look(starter), ot = await look(other);
  ok('начинающий взламывает замок соперника', st.own === String(other === A ? seatA : seatB), st.own);
  ok('у второго на экране его собственный замок', ot.own === String(other === A ? seatA : seatB), ot.own);
  ok('код соперника нигде не показан', st.codes === '' && ot.codes === '', [st.codes, ot.codes]);
}

rep.head('четыре попытки за ход');
const MISS_1 = ['0000','1111','2222','3333'];      /* ни один не открывает 5678 */
for (let i = 0; i < MISS_1.length; i++){
  const g = MISS_1[i];
  ok('попытка ' + (i + 1) + ': код набран', await setCode(starter, g));
  await press(starter);
  const seen = (s) => s.rows.length === i + 1 && s.rows[i].g === g;
  const st = await grab(starter, seen), ot = await grab(other, seen);
  ok('попытка ' + (i + 1) + ': строка появилась у обоих', !!st && !!ot);
  if (!st || !ot) break;
  const want = feedback(CODE.get(other), g);
  ok('попытка ' + (i + 1) + ': подсказка верная',
     st.rows[i].x === want.x && st.rows[i].y === want.y, [st.rows[i], want]);
  ok('попытка ' + (i + 1) + ': у обоих она одна и та же',
     JSON.stringify(st.rows) === JSON.stringify(ot.rows), [st.rows[i], ot.rows[i]]);
}
ok('после четырёх попыток ходит второй',
   await until(other, look, (s) => s.act === 'Проверить код' && s.can, 14000), (await look(other)).act);
ok('а начинающий ждёт', await until(starter, look, (s) => /подбирает код/.test(s.act), 12000),
   (await look(starter)).act);
ok('журнал переключился на второго', (await look(other)).rows.length === 0, (await look(other)).rows.length);

rep.head('ход соперника');
const MISS_2 = ['9999','8888','7777','6666'];      /* ни один не открывает 1234 */
for (let i = 0; i < MISS_2.length; i++){
  ok('ответ ' + (i + 1) + ': код набран', await setCode(other, MISS_2[i]));
  await press(other);
  const seen = (s) => s.rows.length === i + 1 && s.rows[i].g === MISS_2[i];
  ok('ответ ' + (i + 1) + ': строка у обоих',
     !!(await grab(other, seen)) && !!(await grab(starter, seen)));
}
ok('очередь вернулась к начинающему',
   await until(starter, look, (s) => s.act === 'Проверить код' && s.can, 14000), (await look(starter)).act);

rep.head('замок открыт — у второго ответный ход');
ok('верный код набран', await setCode(starter, CODE.get(other)));
await press(starter);
ok('замок открылся', await until(starter, look, (s) => s.open, 12000));
ok('второй тоже увидел, что его замок вскрыт', await until(other, look, (s) => s.open, 12000));
ok('партия ещё не кончилась — есть ответный ход',
   await until(other, look, (s) => s.act === 'Проверить код' && s.can && !s.sheet, 16000), (await look(other)).act);
{
  const o = await look(other);
  ok('второго предупредили о последнем шансе', /Последний шанс|последний шанс/.test(o.hint), o.hint);
  ok('итог ещё не показан', !o.sheet && (await look(starter)).sheet === false);
}

rep.head('ответный ход не удался');
const MISS_3 = ['5555','4444','3333','2222'];      /* ни один не открывает 1234 */
for (let i = 0; i < MISS_3.length; i++){
  ok('последний шанс ' + (i + 1) + ': код набран', await setCode(other, MISS_3[i]));
  await press(other);
  /* журнал у каждого свой и копится за весь раунд: четыре попытки первого
     хода уже лежат в нём, ответный ход дописывается к ним */
  const n = MISS_2.length + i + 1;
  ok('последний шанс ' + (i + 1) + ': попытка записана',
     await quiet(other, (s) => s.rows.length === n || s.sheet, 14000), (await look(other)).rows.length);
}
ok('итог показан обоим', await until(A, look, (s) => s.sheet, 14000) && await until(B, look, (s) => s.sheet, 14000));
{
  const st = await look(starter), ot = await look(other);
  ok('победил начинающий — он и слышит это первым', /взломали|Победа/.test(st.title), st.title);
  ok('проигравшему сказано, что замок вскрыли у него', /взломал/.test(ot.title), ot.title);
  ok('счёт сошёлся у обоих', st.s1 === ot.s1 && st.s2 === ot.s2, [st.s1 + ':' + st.s2, ot.s1 + ':' + ot.s2]);
  ok('победа записана начинающему', (starter === A ? (seatA === 1 ? st.s1 : st.s2) : (seatB === 1 ? st.s1 : st.s2)) === '1',
     [st.s1, st.s2]);
  ok('оба кода наконец показаны', st.codes.split('/').sort().join('/') === '1234/5678', st.codes);
  ok('и у второго те же', ot.codes.split('/').sort().join('/') === '1234/5678', ot.codes);
  ok('в подписи — число попыток', /попыт/.test(st.sub), st.sub);
}

rep.head('реванш');
await A.locator('#again').click();
ok('первый ждёт соперника', await until(A, look, (s) => /Ждём/.test(s.again), 8000), (await look(A)).again);
await B.locator('#again').click();
ok('новый раунд у обоих',
   await until(A, look, (s) => !s.sheet && s.act === 'Запереть замок', 14000) &&
   await until(B, look, (s) => !s.sheet && s.act === 'Запереть замок', 14000));
{
  const a = await look(A), b = await look(B);
  ok('счёт не обнулился', a.s1 === b.s1 && a.s2 === b.s2 && (a.s1 === '1' || a.s2 === '1'), [a.s1, a.s2]);
  ok('коды прошлого раунда убраны', a.codes === '' && b.codes === '', [a.codes, b.codes]);
}
/* во втором раунде начинает второе место — проверяем по тому, кто ходит
   первым после обмена кодами; порядок запирания теперь обычный */
ok('первый запер замок', await setCode(A, '4321'));
await press(A);
ok('второй запер замок', await setCode(B, '8765'));
await press(B);
const first = await until(B, look, (s) => s.act === 'Проверить код' && s.can, 16000);
ok('во втором раунде начинает второе место', first, (await look(B)).act);
ok('а первое место ждёт', await until(A, look, (s) => /подбирает код/.test(s.act), 12000), (await look(A)).act);

rep.head('обрыв связи');
await B.locator('#toMenu').click();
ok('первого предупредили', await until(A, lobby.warned, (w) => w && w.shown && /вышел/.test(w.text), 14000));

await browser.close();
process.exit(rep.done('Взломщик кода'));
