/* Оснастка для долгой сетевой партии в трудных условиях.

   Обычные тесты играют по сети на идеальной связи и проверяют правила.
   Здесь другое: связь рвётся и тормозит, а мы смотрим не на правила, а на
   то, не начинает ли одна из сторон переигрывать ходы сама по себе.

   Подсматриваем за разговором с сервером через подменённый fetch: у каждого
   запроса есть `since` — сколько ходов раунда у клиента уже есть. В пределах
   раунда это число обязано только расти. Если оно поехало назад, клиент
   потерял ход и сервер будет слать ему один и тот же хвост снова и снова —
   это и выглядит как «игра сама повторяет ходы до бесконечности». */

/* записываем каждый запрос к /api/ и ответ на него */
export async function probe(page){
  await page.addInitScript(() => {
    window.__api = [];
    var real = window.fetch;
    window.fetch = function(url, opt){
      var u = String(url);
      if (u.indexOf('/api/') < 0) return real.apply(this, arguments);
      var body = {};
      try { body = JSON.parse((opt && opt.body) || '{}'); } catch(e){}
      var rec = { at: Date.now(), action: u.split('/api/')[1], since: body.since,
                  sent: body.move, mid: body.mid, status: 0 };
      window.__api.push(rec);
      return real.apply(this, arguments).then(function(r){
        rec.status = r.status;
        r.clone().text().then(function(t){
          var j = {};
          try { j = JSON.parse(t); } catch(e){}
          rec.total = j.total; rec.round = j.round; rec.turn = j.turn;
          rec.got = (j.moves || []).length;
        }, function(){});
        return r;
      }, function(e){ rec.status = 0; throw e; });
    };
  });
}

/* Плохая связь — как на телефоне, а не как в тесте.

   Тут важно различать три разные беды, потому что ломают они по-разному:

   - запрос не дошёл вовсе: сервер ничего не узнал, клиент повторит — не страшно;
   - **дошёл, а ответ потерялся**: ход на сервере уже есть, а клиент этого не
     знает и шлёт его снова;
   - **застрял в дороге**: клиент успел сдаться, повторить ход и сходить ещё
     раз, и только потом первый запрос доезжает до сервера.

   Последнее и есть метро с лифтом: пакет висит в сети несколько секунд и
   приходит, когда его уже никто не ждёт.

   И четвёртая: **запрос повис и не кончается вовсе** — ни ответа, ни ошибки.
   Без предела ожидания в net.js такой запрос останавливал опрос у игрока
   насовсем, и партия у него замирала. */
export async function flaky(page, opt){
  var o = opt || {};
  var lose = o.lose === undefined ? 0.1 : o.lose;      /* запрос не дошёл */
  var deaf = o.deaf === undefined ? 0.1 : o.deaf;      /* дошёл, ответ потерялся */
  var late = o.late === undefined ? 0.1 : o.late;      /* застрял и дойдёт позже */
  var slow = o.slow === undefined ? 0.15 : o.slow;     /* просто медленно */
  var hang = o.hang === undefined ? 0.02 : o.hang;     /* повис: ни ответа, ни ошибки */
  var hold = o.hold === undefined ? 1100 : o.hold;
  var seed = o.seed || 7;
  var rnd = function(){ seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  await page.context().route('**/api/**', async (route) => {
    var r = rnd();
    if (r < lose){ await route.abort('connectionfailed'); return; }
    if (r < lose + deaf){
      try { await route.fetch(); } catch(e){}          /* сервер ход принял … */
      await route.abort('connectionfailed');           /* … а клиент об этом не узнал */
      return;
    }
    if (r < lose + deaf + late){
      var req = route.request();
      var body = req.postData();
      var url = req.url();
      setTimeout(function(){
        fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body })
          .catch(function(){});
      }, hold + 900);                                  /* доедет, когда клиент уже повторил ход */
      await route.abort('connectionfailed');
      return;
    }
    if (r < lose + deaf + late + slow) await new Promise(res => setTimeout(res, hold));
    else if (r < lose + deaf + late + slow + hang){
      await new Promise(res => setTimeout(res, 40000));            /* дольше любого разумного ожидания */
      try { await route.abort('timedout'); } catch(e){}
      return;
    }
    await route.continue();
  });
}

/* Телефон на несколько секунд потерял сеть. Пока он молчит, соперник
   успевает сходить целиком, и при возвращении связи сервер отдаст ему
   пачку ходов разом — вместе со своей очередью, которая относится уже к
   миру ПОСЛЕ этих ходов. Самый опасный момент сетевой игры. */
export async function blackout(page, ms){
  const off = async (route) => { await route.abort('connectionfailed'); };
  await page.context().route('**/api/**', off);
  await new Promise(r => setTimeout(r, ms));
  await page.context().unroute('**/api/**', off);
}

export const api = (page) => page.evaluate(() => window.__api.slice());

/* Что должно быть правдой у любой игры после долгой партии на плохой связи. */
export function judge(rep, label, recs, moves){
  const ok = rep.ok;
  const answered = recs.filter(r => r.status === 200 && r.since !== undefined && r.total !== undefined);
  /* ходы раунда клиент считает только вперёд: назад — значит ход потерян */
  let back = null, prev = null, round = 0;
  for (const r of answered){
    if (r.round > round){ round = r.round; prev = null; continue; }        /* новый раунд — счёт с нуля */
    if (r.action === 'again' || r.since === 0){ prev = null; continue; }   /* пересборка и реванш спрашивают с нуля */
    if (prev && r.since < prev.since) { back = [prev, r]; break; }
    prev = r;
  }
  ok(label + ': счёт ходов не едет назад — ход не теряется', !back, back);

  /* сколько ходов нам отдали всего: пересборка добавляет раунд целиком,
     но десятикратного повтора быть не должно ни при какой связи */
  const got = answered.reduce((s, r) => s + (r.got || 0), 0);
  ok(label + ': сервер не пересылает одни и те же ходы без конца', got <= moves * 3 + 12, { got, moves });
  return { back, got };
}
