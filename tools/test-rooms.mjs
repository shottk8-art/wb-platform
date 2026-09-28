/* Проверка логики комнат без сети: гоняем handle() на хранилище в памяти. */
import { handle, starterOf, okMove } from '../netlify/functions/lib/rooms.mjs';
import { memStore } from './memstore.mjs';

const store = memStore();

let failed = 0;
function ok(name, cond, extra){
  if (cond) console.log('  ok  ', name);
  else { failed++; console.log('  ПЛОХО', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
const call = (a, d) => handle(store, a, d);

console.log('очерёдность');
ok('раунд 0 начинает первый', starterOf(0) === 1);
ok('раунд 1 начинает второй', starterOf(1) === 2);

console.log('что считается ходом');
ok('число — ход', okMove(3));
ok('ноль — ход', okMove(0));
ok('слово — ход', okMove('ковёр'));
ok('пара чисел — ход', okMove([2, 14]));
ok('пусто — не ход', !okMove(null) && !okMove(undefined));
ok('объект — не ход', !okMove({ a: 1 }));
ok('длинная строка — не ход', !okMove('я'.repeat(65)));
ok('длинный массив — не ход', !okMove([1,2,3,4,5,6,7,8,9]));
ok('NaN — не ход', !okMove(NaN));
/* ход соперника показывается на экране — разметку в нём пропускать нельзя */
ok('код замка и метка ребра — ход', okMove(['s', '0421']) && okMove(['h', 1, 2]) && okMove('ёлка'));
ok('разметка — не ход', !okMove('<img src=x>') && !okMove(['s', '<b>1</b>']) && !okMove('a"b'));

console.log('имена игроков');
{
  const r = await call('create', { game: 'dvoeplay', name: '<i>Ася</i>' });
  const j = await call('join', { code: r.body.code, game: 'dvoeplay', name: 'Карл<script>' });
  ok('угловые скобки из имени вырезаны', j.body.oppName === 'iАся/i', j.body.oppName);
  const st = await call('state', { code: r.body.code, token: r.body.token, since: 0 });
  ok('и у второго игрока тоже', st.body.oppName === 'Карлscript', st.body.oppName);
  ok('токен — 32 случайных шестнадцатеричных знака', /^[0-9a-f]{32}$/.test(r.body.token) && r.body.token !== j.body.token, r.body.token);
}

console.log('комната');
const a = await call('create', { game: 'matreshka' });
ok('создана', a.status === 200 && /^\d{5}$/.test(a.body.code), a.body);
ok('очередь пришла сразу', a.body.turn === 1 && a.body.round === 0, a.body);
const code = a.body.code, t1 = a.body.token;

ok('чужой токен не пускают', (await call('state', { code, token: 'левый' })).status === 403);
const s0 = await call('state', { code, token: t1, since: 0 });
ok('пока один', s0.body.joined === false && s0.body.seat === 1, s0.body);

const wrongGame = await call('join', { code, game: 'viselica' });
ok('в чужую игру не пускают', wrongGame.status === 409, wrongGame.body);

const b = await call('join', { code, game: 'matreshka' });
ok('второй вошёл', b.status === 200 && b.body.seat === 2, b.body);
const t2 = b.body.token;
ok('сид общий', b.body.seed === a.body.seed);
ok('игра названа', b.body.game === 'matreshka');
ok('третьего не пускают', (await call('join', { code })).status === 409);

console.log('ходы и очередь');
ok('не в свой ход нельзя', (await call('move', { code, token: t2, move: 3, round: 0, next: 1 })).status === 409);

const m1 = await call('move', { code, token: t1, move: [2, 4], round: 0, next: 2 });
ok('первый сходил парой чисел', m1.status === 200 && m1.body.total === 1, m1.body);
ok('очередь ушла второму', m1.body.turn === 2, m1.body);
ok('дважды подряд нельзя', (await call('move', { code, token: t1, move: 5, round: 0, next: 2 })).status === 409);

/* главное новшество: ход может остаться за тем же игроком */
const m2 = await call('move', { code, token: t2, move: 7, round: 0, next: 2 });
ok('второй оставил ход себе', m2.body.turn === 2 && m2.body.total === 2, m2.body);
const m3 = await call('move', { code, token: t2, move: 8, round: 0, next: 1 });
ok('и сходил ещё раз', m3.body.total === 3 && m3.body.turn === 1, m3.body);
ok('теперь снова первый', (await call('move', { code, token: t2, move: 9, round: 0, next: 1 })).status === 409);

const m4 = await call('move', { code, token: t1, move: 'ковёр', round: 0, next: 2 });
ok('словом тоже можно', m4.status === 200 && m4.body.total === 4, m4.body);
ok('чужой раунд не принимают', (await call('move', { code, token: t2, move: 1, round: 7, next: 1 })).status === 409);
ok('мусор вместо хода не принимают', (await call('move', { code, token: t2, move: { x: 1 }, round: 0, next: 1 })).status === 400);
const noNext = await call('move', { code, token: t2, move: 2, round: 0 });
ok('без «кому дальше» очередь просто переходит', noNext.body.turn === 1, noNext.body);

console.log('догон состояния');
const s1 = await call('state', { code, token: t2, since: 3 });
ok('отдаёт только новое', s1.body.moves.length === 2 && s1.body.moves[0] === 'ковёр', s1.body.moves);
ok('соперник на связи', s1.body.oppOnline === true);
ok('оба на местах', s1.body.joined === true);
const sAll = await call('state', { code, token: t1, since: 0 });
ok('целиком тоже отдаёт', sAll.body.moves.length === 5, sAll.body.moves);

console.log('итог и реванш');
const r = await call('result', { code, token: t1, winner: 1 });
ok('итог записан', r.body.result && r.body.result.winner === 1, r.body.result);
ok('переписать итог нельзя', (await call('result', { code, token: t2, winner: 2 })).body.result.winner === 1);

const g1 = await call('again', { code, token: t1 });
ok('один согласился — раунд тот же', g1.body.round === 0 && g1.body.rematch[0] === true, g1.body);
const g2 = await call('again', { code, token: t2 });
ok('оба согласились — новый раунд', g2.body.round === 1, g2.body);
ok('поле очищено', g2.body.total === 0 && g2.body.moves.length === 0);
ok('итог сброшен', g2.body.result === null);
ok('флаги сброшены', g2.body.rematch[0] === false && g2.body.rematch[1] === false);
ok('во втором раунде начинает второй', g2.body.turn === 2, g2.body);
ok('первый не ходит в чужую очередь', (await call('move', { code, token: t1, move: 0, round: 1, next: 2 })).status === 409);
ok('второй ходит', (await call('move', { code, token: t2, move: 0, round: 1, next: 1 })).status === 200);

console.log('уход');
ok('вышел', (await call('leave', { code, token: t2 })).body.left === true);
const s2 = await call('state', { code, token: t1, since: 0 });
ok('видно, что соперник ушёл', s2.body.oppLeft === true && s2.body.oppOnline === false, s2.body);
const closed = await call('leave', { code, token: t1 });
ok('ушли оба — комната закрылась', closed.body.closed === true, closed.body);
ok('её больше нет', (await call('state', { code, token: t1 })).status === 404);

console.log('опоздавший ход');
/* Телефон в лифте: запрос завис в сети, клиент сдался и повторил ход, потом
   успел сходить ещё раз (в «Мемо-дуэли» и «Захлопни ящик» это обычное дело —
   ход остаётся за тем же игроком), и только теперь до сервера доезжает самый
   первый запрос. Принять его нельзя: ход попадёт в список дважды, и у обоих
   игроков поле поедет — карточка перевернётся сама, кубики бросятся сами. */
{
  const r = await call('create', { game: 'memo-duel' });
  const c = r.body.code, ta = r.body.token;
  const tb = (await call('join', { code: c, game: 'memo-duel' })).body.token;
  const mv = (token, move, mid, next) => call('move', { code: c, token, move, mid, next, round: 0 });
  ok('ход прошёл', (await mv(ta, 5, 'aaa:1', 1)).status === 200);          /* пара сошлась — ход остаётся */
  ok('повтор того же хода не удваивает список',
     (await mv(ta, 5, 'aaa:1', 1)).body.total === 1);
  ok('следующий ход прошёл', (await mv(ta, 7, 'aaa:2', 1)).body.total === 2);
  const late = await mv(ta, 5, 'aaa:1', 1);
  ok('опоздавший первый запрос не применяется второй раз', late.body.total === 2, late.body.total);
  ok('после него очередь не сбилась', late.body.turn === 1, late.body.turn);
  ok('новый ход по-прежнему принимается', (await mv(ta, 9, 'aaa:3', 2)).body.total === 3);
  ok('перезашедший игрок начинает счёт заново и не блокируется',
     (await mv(tb, 3, 'bbb:1', 1)).body.total === 4);
  await call('leave', { code: c, token: ta });
  await call('leave', { code: c, token: tb });
}

console.log('ход с устаревшего поля');
/* Экран соперника отстал на один ход — он тапает по карточке, которую у него
   ещё не забрали. Принять такой ход нельзя: разыграть его у второго игрока
   не получится, и тот будет пересобирать раунд без конца. */
{
  const r = await call('create', { game: 'memo-duel' });
  const c = r.body.code, ta = r.body.token;
  const tb = (await call('join', { code: c, game: 'memo-duel' })).body.token;
  const mv = (token, move, mid, next, since) => call('move', { code: c, token, move, mid, next, since, round: 0 });
  ok('первый ход — «знаю один ход, свой»', (await mv(ta, 1, 'aaa:1', 2, 1)).status === 200);
  const stale = await mv(tb, 2, 'bbb:1', 1, 1);
  ok('ход с отставшего поля не принимают', stale.status === 409, stale.body);
  ok('догнал — ходит', (await mv(tb, 2, 'bbb:2', 1, 2)).status === 200);
  ok('в списке ровно два хода', (await call('state', { code: c, token: ta, since: 0 })).body.total === 2);
  await call('leave', { code: c, token: ta });
  await call('leave', { code: c, token: tb });
}

console.log('комната без очереди');
/* «Доббль»: ходят оба одновременно, кто быстрее. Сервер очередь не спрашивает
   и не двигает — просто складывает заявки в общий список в порядке прихода. */
{
  const r = await call('create', { game: 'dobble', free: true });
  const c = r.body.code, ta = r.body.token;
  const tb = (await call('join', { code: c, game: 'dobble' })).body.token;
  const mv = (token, move, mid, since) => call('move', { code: c, token, move, mid, since, round: 0 });
  ok('второй ходит первым — можно', (await mv(tb, [2, 0, 7], 'b:1', 0)).status === 200);
  ok('и сразу снова — очереди нет', (await mv(tb, [2, 1, 3], 'b:2', 1)).status === 200);
  const first = await mv(ta, [1, 0, 7], 'a:1', 0);
  ok('опоздавший с устаревшим since тоже принят', first.status === 200, first.body);
  const seen = await call('state', { code: c, token: ta, since: 0 });
  ok('все три заявки в списке по порядку прихода',
     JSON.stringify(seen.body.moves) === JSON.stringify([[2,0,7],[2,1,3],[1,0,7]]), seen.body.moves);
  ok('повтор с той же меткой не удваивает', (await mv(tb, [2,0,7], 'b:1', 0)).body.total === 3);
  await call('leave', { code: c, token: ta });
  await call('leave', { code: c, token: tb });
}
{
  /* обычная комната от этого не меняется */
  const r = await call('create', { game: 'memo-duel' });
  const c = r.body.code, ta = r.body.token;
  const tb = (await call('join', { code: c, game: 'memo-duel' })).body.token;
  ok('в обычной комнате очередь по-прежнему проверяется',
     (await call('move', { code: c, token: tb, move: 1, mid: 'z:1', since: 1, round: 0 })).status === 409);
  await call('leave', { code: c, token: ta });
  await call('leave', { code: c, token: tb });
}

console.log('ошибки');
ok('нет такой комнаты — 404', (await call('state', { code: '00001', token: t1 })).status === 404);
ok('короткий код — 400', (await call('state', { code: '12', token: t1 })).status === 400);
const fresh = await call('create', { game: 'dvoeplay' });   /* прежнюю комнату уже закрыли выше */
ok('неизвестное действие — 400',
   (await call('пляши', { code: fresh.body.code, token: fresh.body.token })).status === 400);

console.log(failed ? '\nПРОВАЛЕНО проверок: ' + failed : '\nвсе проверки прошли');
process.exit(failed ? 1 : 0);
