#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Сплошная проверка приложения dvoeplay: синтаксис, ссылки на элементы,
   согласованность общих блоков и сетевой обвязки во всех играх."""
import io, os, re, subprocess, sys, collections

PUB = '/home/claude/net/public'
GAMES = ['dvoeplay','matreshka','magnitniy-boy','memo-duel','dots-boxes',
         '5-bukv','viselica','zahlopni-yaschik','dobble','vzlomshik']
ALL = GAMES + ['index']

problems = []
notes = []
def bad(where, what):  problems.append((where, what))
def note(where, what): notes.append((where, what))

def read(name): return io.open(os.path.join(PUB, name + '.html'), encoding='utf-8').read()

src = {n: read(n) for n in ALL}
netjs = io.open(os.path.join(PUB, 'net.js'), encoding='utf-8').read()

def scripts(s):
    return re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', s, re.S)

# ───────────────── 1. синтаксис ─────────────────
def check_js(code, where):
    p = '/tmp/claude-0/audit-chk.js'
    io.open(p, 'w', encoding='utf-8').write(code)
    r = subprocess.run(['node','--check',p], capture_output=True, text=True)
    if r.returncode != 0:
        bad(where, 'синтаксис JS: ' + r.stderr.strip().split('\n')[0])

for n in ALL:
    for i, code in enumerate(scripts(src[n])):
        check_js(code, n + '.html (скрипт ' + str(i+1) + ')')
check_js(netjs, 'net.js')

# ───────────────── 2. парность тегов ─────────────────
for n in ALL:
    s = src[n]
    for t in ['html','head','body','style','script','section','aside','div','button','span','p','h1','h2','a','svg']:
        o = len(re.findall(r'<%s(?=[\s>])' % t, s))
        c = len(re.findall(r'</%s>' % t, s))
        if o != c:
            bad(n + '.html', 'непарные <%s>: открыто %d, закрыто %d' % (t, o, c))

# ───────────────── 3. одинаковые id ─────────────────
for n in ALL:
    ids = re.findall(r'\sid="([^"]+)"', src[n])
    dup = [k for k, v in collections.Counter(ids).items() if v > 1]
    if dup: bad(n + '.html', 'повторяющиеся id: ' + ', '.join(dup))

# ───────────────── 4. getElementById на несуществующий id ─────────────────
# id, которые создаёт net.js (он вставляет свою разметку сам)
NET_IDS = set(re.findall(r"id=\\?\"(np[A-Za-z]+)\\?\"", netjs)) | set(re.findall(r"id='(np[A-Za-z]+)'", netjs))
for n in ALL:
    s = src[n]
    have = set(re.findall(r'\sid="([^"]+)"', s)) | NET_IDS
    js = '\n'.join(scripts(s))
    # id, создаваемые в JS динамически
    have |= set(re.findall(r"\.id\s*=\s*['\"]([^'\"]+)['\"]", js))
    have |= set(re.findall(r"id=\"([^\"]+)\"", js))         # из строк разметки внутри JS
    have |= set(re.findall(r"id='([^']+)'", js))
    used = set(re.findall(r"getElementById\(['\"]([^'\"]+)['\"]\)", js))
    miss = sorted(used - have)
    if miss: bad(n + '.html', 'JS ищет несуществующие id: ' + ', '.join(miss))

# ───────────────── 5. общие блоки серии ─────────────────
for n in ALL:
    s = src[n]
    if "var DP=(function(){" not in s: bad(n + '.html', 'нет общего блока памяти DP')
    if "var FX=(function(){" not in s: bad(n + '.html', 'нет общего блока звука FX')
    if 'aria-live="polite" id="live"' not in s: bad(n + '.html', 'нет строки для скринридера #live')
    if "CUT=4500" not in s: bad(n + '.html', 'срез фильтра звука не 4500')
    if "VOL=0.95" not in s: bad(n + '.html', 'громкость звука не 0.95')

# Блок памяти DP обязан быть побайтово одинаков во всех файлах: он пишет
# историю и счёт пары, а главный экран её читает. Разойдись он хоть в
# одной игре — её партии считались бы по-другому, и никто бы этого не заметил.
def dp_block(s):
    a = s.find('var DP=(function(){')
    if a < 0: return None
    b = s.find('return {read:read', a)
    return s[a:s.find('})();', b) + 5] if b > 0 else None
ref = dp_block(src['dobble'])
for n in ALL:
    if dp_block(src[n]) != ref:
        bad(n + '.html', 'блок памяти DP отличается от остальных файлов — копируйте его целиком')

# Список фантов серии тоже один на всех: в играх он раздаёт фанты, на главном
# подсказывает, что вписать в турнире. Разойдутся — подсказка перестанет
# совпадать с тем, что выпадает в играх.
def forfeit_block(s):
    a = s.find('var FORFEIT=[')
    return s[a:s.find('\n];', a) + 3] if a >= 0 else None
fref = forfeit_block(src['dobble'])
for n in ALL:
    fb = forfeit_block(src[n])
    if fb is None: bad(n + '.html', 'нет общего списка фантов FORFEIT')
    elif fb != fref: bad(n + '.html', 'список фантов FORFEIT отличается от остальных файлов')

# приложение, а не сайт: установка, иконки, офлайн, Telegram — во всех файлах
for n in ALL:
    s = src[n]
    head = s.split('<style>')[0]
    if 'rel="manifest" href="manifest.webmanifest"' not in head:
        bad(n + '.html', 'нет ссылки на манифест — не установится как приложение')
    if 'rel="apple-touch-icon" href="apple-touch-icon.png"' not in head:
        bad(n + '.html', 'нет PNG-иконки для экрана «Домой» на iPhone')
    if 'apple-mobile-web-app-title" content="dvoeplay"' not in head:
        bad(n + '.html', 'у ярлыка на iPhone другое название')
    if 'apple-mobile-web-app-status-bar-style" content="default"' not in head:
        bad(n + '.html', 'другой стиль строки состояния')
    if "serviceWorker.register('sw.js')" not in head:
        bad(n + '.html', 'не включает офлайн-режим')
    if 'telegram-web-app.js' not in head:
        bad(n + '.html', 'внутри Telegram не подключится к нему')
    if '<link rel="icon" type="image/svg+xml" href="favicon.svg">' not in head:
        bad(n + '.html', 'значок вкладки не тот, что у приложения')
    # превью ссылки в мессенджерах: приглашение в сетевую игру — это ссылка,
    # и без этих тегов она приходит голой строкой, без картинки и описания
    for t, why in [('name="description" content="', 'описание страницы'),
                   ('property="og:title" content="', 'заголовок превью'),
                   ('property="og:description" content="', 'описание превью'),
                   ('property="og:image" content="https://', 'картинка превью по полному адресу'),
                   ('name="twitter:card" content="summary_large_image"', 'крупная картинка превью')]:
        if t not in head: bad(n + '.html', 'нет превью для ссылки: ' + why)
    m = re.search(r'property="og:image" content="https://[^/"]+/([^"]+)"', head)
    if m and not os.path.exists(os.path.join(PUB, m.group(1))):
        bad(n + '.html', 'картинки превью ' + m.group(1) + ' нет в папке сайта')

# офлайн-режим: список файлов в sw.js совпадает с тем, что лежит в папке сайта.
# PNG-иконки — наоборот, в кеше им не место: их читает система, а не страница,
# и старая копия из кеша не дала бы новой иконке доехать до телефона.
sw = io.open(os.path.join(PUB, 'sw.js'), encoding='utf-8').read()
listed = set(re.findall(r"^  '([^']+)',?$", sw, re.M)) - {'./'}
real = set(f for f in os.listdir(PUB)
           if f.endswith('.html') or f in ('net.js', 'tour.js', 'manifest.webmanifest')
           or f.endswith('.svg'))
for f in sorted(real - listed): bad('sw.js', 'файл ' + f + ' не попадёт в кеш — без сети не откроется')
for f in sorted(listed - real):
    if f.endswith('.png'):
        bad('sw.js', f + ' в офлайн-кеше: иконки должны идти мимо кеша, иначе новая не доедет до телефона')
    else:
        bad('sw.js', 'в списке кеша есть ' + f + ', а такого файла нет — установка сорвётся')
if "pathname.endsWith('.png')) return;" not in sw:
    bad('sw.js', 'PNG-иконки идут через кеш — система получит старую иконку вместо новой')

# манифест: иконки на месте
try:
    import json
    man = json.load(io.open(os.path.join(PUB, 'manifest.webmanifest'), encoding='utf-8'))
    for ic in man.get('icons', []):
        if not os.path.exists(os.path.join(PUB, ic['src'])):
            bad('manifest.webmanifest', 'нет файла иконки ' + ic['src'])
    if man.get('display') != 'standalone':
        bad('manifest.webmanifest', 'display не standalone — откроется с адресной строкой')
except Exception as e:
    bad('manifest.webmanifest', 'не читается: ' + str(e))

# в большой плашке у каждой игры своя живая картинка
hub = src['index']
art = set(re.findall(r"'([\w-]+)':'<div class=\"hero-art", hub))
for n in GAMES:
    if n not in art:
        bad('index.html', 'нет живой картинки в плашке для игры ' + n)

# тема: выбор игрока обязан применяться во всех файлах приложения
for n in ALL:
    s = src[n]
    if 'data-theme' not in s:
        bad(n + '.html', 'тема не умеет подчиняться выбору игрока (нет data-theme)')
        continue
    if ':root[data-theme="dark"]{' not in s:
        bad(n + '.html', 'нет тёмных переменных по атрибуту data-theme')
    if ':root:not([data-theme="light"])' not in s:
        bad(n + '.html', 'системная тёмная тема перебивает выбор «светлая»')
    if "localStorage.getItem('dvoeplay:v1')" not in s.split('<style>')[0]:
        bad(n + '.html', 'тема применяется не до отрисовки — приложение будет мигать при запуске')
    if 'color-scheme:light' not in s or 'color-scheme:dark' not in s:
        bad(n + '.html', 'не объявлена color-scheme — поля ввода не пойдут за темой')
    if 'theme:theme' not in s:
        bad(n + '.html', 'память не отдаёт тему (DP.theme)')

for n in GAMES:
    s = src[n]
    if 'class="tohub" href="index.html"' not in s: bad(n + '.html', 'нет кнопки «Все игры»')
    if 'id="again"' not in s: bad(n + '.html', 'нет кнопки #again — net.js не сможет вести реванш')
    if 'class="forfeit"' not in s: bad(n + '.html', 'нет компонента фанта')

# ───────────────── 6. сетевая обвязка ─────────────────
for n in GAMES:
    s = src[n]
    js = '\n'.join(scripts(s))
    if '<script src="net.js"></script>' not in s: bad(n + '.html', 'не подключён net.js')
    else:
        i_net = s.index('<script src="net.js"></script>')
        i_own = s.index('<script>', i_net) if '<script>' in s[i_net:] else -1
        if i_own < 0: bad(n + '.html', 'net.js подключён после скрипта игры')
    if 'data-mode="3"' not in s: bad(n + '.html', 'нет строки меню «По сети»')
    if 'NET.init({' not in js: bad(n + '.html', 'нет NET.init')
    m = re.search(r"NET\.init\(\{(.*?)\n\}\);", js, re.S)
    if not m:
        bad(n + '.html', 'не удалось разобрать NET.init')
    else:
        body = m.group(1)
        for key in ['game:', 'title:', 'applied:', 'begin:', 'round:', 'move:', 'ended:']:
            if key not in body: bad(n + '.html', 'в NET.init нет поля ' + key)
        gm = re.search(r"game:'([^']+)'", body)
        if gm and gm.group(1) != n:
            bad(n + '.html', "в NET.init game:'%s', а файл называется %s" % (gm.group(1), n))
    if 'playing-net' not in s: bad(n + '.html', 'нет признака сетевой партии playing-net')
    if 'NET.on) NET.leave()' not in js and 'NET.on){ NET.leave' not in js:
        bad(n + '.html', 'выход в меню не закрывает комнату')
    if 'NET.rematch()' not in js: bad(n + '.html', 'кнопка «играть снова» не ведёт к сетевому реваншу')
    if not re.search(r"\.playing-net #(reset|restart)\{display:none\}", s):
        bad(n + '.html', 'кнопка «начать заново» не спрятана в сетевой партии')
    if not re.search(r"var net=\{seat:", js): bad(n + '.html', 'нет объявления net={seat…}')

from html.parser import HTMLParser
VOID = {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
def where_inside(html, root):
    """какие id и классы (.имя) встречаются внутри элемента с id=root"""
    found = {}
    class P(HTMLParser):
        def __init__(self):
            super().__init__(); self.stack = []
        def handle_starttag(self, tag, attrs):
            a = dict(attrs); inn = any(x == root for x in self.stack)
            if inn:
                if a.get('id'): found[a['id']] = True
                for c in (a.get('class') or '').split(): found['.' + c] = True
            if tag not in VOID: self.stack.append(a.get('id') or '')
        def handle_startendtag(self, tag, attrs):
            a = dict(attrs)
            if any(x == root for x in self.stack):
                if a.get('id'): found[a['id']] = True
                for c in (a.get('class') or '').split(): found['.' + c] = True
        def handle_endtag(self, tag):
            if tag in VOID: return
            if self.stack: self.stack.pop()
    P().feed(re.sub(r'<script\b.*?</script>', '', re.sub(r'<style\b.*?</style>', '', html, flags=re.S), flags=re.S))
    return found

# ───────────────── 6а. мини-турнир ─────────────────
# tour.js ведёт турнир во всех играх, ничего в них не меняя: запускает
# партию вдвоём строкой меню, прячет «Играть снова» и фант и кладёт свою
# панель в шторку итога. Значит, у каждой игры обязаны быть эти элементы.
for n in GAMES:
    s = src[n]
    if '<script src="tour.js"></script>' not in s:
        bad(n + '.html', 'не подключён tour.js — турнир не сможет вести эту игру')
    else:
        i_t = s.index('<script src="tour.js"></script>')
        if '<script>' not in s[i_t:]: bad(n + '.html', 'tour.js подключён после скрипта игры')
    if 'data-mode="2"' not in s: bad(n + '.html', 'нет строки меню «Вдвоём» — турнир не запустит партию')
    if 'id="sheet"' not in s: bad(n + '.html', 'нет шторки итога #sheet — некуда положить панель турнира')
    # панель встаёт перед #again в его же родителе — значит, #again обязан быть
    # внутри шторки; фант, который турнир прячет, — тоже
    inside = where_inside(s, 'sheet')
    if not inside.get('again'): bad(n + '.html', '#again не внутри #sheet — панель турнира окажется вне шторки')
    if not inside.get('.forfeit'): bad(n + '.html', 'фант .forfeit не внутри #sheet')
    # итог партии турнир узнаёт из DP.save: вызов должен быть ровно один,
    # иначе одна партия засчитается дважды (в «Виселице» — как два раунда)
    k = '\n'.join(scripts(s)).count('DP.save(')
    if k != 1: bad(n + '.html', 'DP.save вызывается %d раз(а) — турниру нужен ровно один вызов на партию' % k)
if '<script src="tour.js"></script>' not in src['index']:
    bad('index.html', 'главный экран не подключает tour.js — турнир не собрать')

# ───────────────── 7. история партий ─────────────────
for n in GAMES:
    js = '\n'.join(scripts(src[n]))
    m = re.search(r"DP\.save\('([^']+)',\{(.*?)\}\);", js, re.S)
    if not m:
        bad(n + '.html', 'не найден вызов DP.save')
        continue
    if m.group(1) != n:
        bad(n + '.html', "DP.save пишет под именем '%s', а файл %s" % (m.group(1), n))
    args = m.group(2)
    if 'mode===3?2:mode' not in args and 'duo()?2:mode' not in args:
        bad(n + '.html', 'сетевая партия пишется в историю не как игра вдвоём')
    if 'По сети' not in args:
        bad(n + '.html', 'в историю не попадает пометка «По сети»')

# ───────────────── 8. режимы: ИИ не должен вмешиваться ─────────────────
AI_HINT = re.compile(r"mode!==2\s*&&\s*turn===2|mode!==2\s*&&\s*p===2|mode!==2\s*&&\s*turn===1")
for n in GAMES:
    js = '\n'.join(scripts(src[n]))
    for mm in AI_HINT.finditer(js):
        line = js[:mm.start()].count('\n') + 1
        bad(n + '.html', 'строка ~%d: «mode!==2 && …===2» — в сетевом режиме это запустит ИИ' % line)

# ───────────────── 9. каталог хаба ─────────────────
hub = src['index']
cat = re.findall(r"\{id:'([^']+)'[^}]*?href:'([^']*)'[^}]*?ready:(true|false)", hub)
seen = set()
for gid, href, ready in cat:
    if ready == 'true':
        seen.add(gid)
        if href != gid + '.html':
            bad('index.html', "у игры %s ссылка '%s' не совпадает с id" % (gid, href))
        if not os.path.exists(os.path.join(PUB, href)):
            bad('index.html', 'ссылка на несуществующий файл: ' + href)
for g in GAMES:
    if g not in seen: bad('index.html', 'игра %s отсутствует в каталоге хаба' % g)
if 'net.js' in hub: bad('index.html', 'хаб подключает net.js, хотя сетевой игры в нём нет')

# ───────────────── 10. net.js: обещанное наружу ─────────────────
for k in ['init','open','close','cancel','send','result','rematch','leave','stop']:
    if ('api_.' + k + ' =') not in netjs: bad('net.js', 'наружу не отдан метод ' + k)
for k in ['on','live','seat','round','seed','rng','turn']:
    if re.search(r'\b' + k + r':', netjs) is None: bad('net.js', 'нет поля ' + k)
if 'console.warn' in netjs: note('net.js', 'осталась диагностика пересборки в консоль (безвредно, помогает разбирать сбои)')

# ───────────────── 11. сервер ─────────────────
rooms = io.open('/home/claude/net/netlify/functions/lib/rooms.mjs', encoding='utf-8').read()
for k in ['starterOf','okMove','handle']:
    if 'export function ' + k not in rooms and 'export async function ' + k not in rooms:
        bad('rooms.mjs', 'не экспортируется ' + k)
for a in ['create','join','state','move','result','again','leave']:
    if "action === '" + a + "'" not in rooms: bad('rooms.mjs', 'нет действия ' + a)
if 'room.turn !== seat' not in rooms: bad('rooms.mjs', 'не проверяется очерёдность хода')


# ───────────────── 12. личные имена сторон в сетевой партии ─────────────────
# Табло не должно показывать «Красные/Жёлтые», когда играют двое по сети:
# у каждого своё место должно называться «Вы».
for n in GAMES:
    s_ = src[n]
    js = '\n'.join(scripts(s_))
    labels = re.findall(r'<span class="name"[^>]*>([^<]+)</span>', s_)
    if not labels:
        continue
    if not any(x in labels for x in ('Красные','Жёлтые')):
        continue
    # значит подписи заданы цветами в разметке — JS обязан переписать их по сети
    setter = re.search(r"getElementById\('name1'\)\.textContent\s*=|nameEl\[1\]\.(innerHTML|textContent)\s*=|nameA\.textContent\s*=", js)
    if not setter:
        bad(n + '.html', 'подписи сторон заданы цветами и не переписываются — по сети будут «Красные/Жёлтые»')

# ───────────────── 13. фант проигравшему в форме «Вы …» ─────────────────
for n in GAMES:
    js = '\n'.join(scripts(src[n]))
    m = re.search(r"function rollForfeit\(\)\{(.*?)\n\}", js, re.S)
    if not m:
        bad(n + '.html', 'не найдена выдача фанта')
        continue
    body = m.group(1)
    if "'Вы '+FORFEIT" not in body:
        bad(n + '.html', 'фант не бывает в форме «Вы …» — по сети проигравший увидит цвет вместо себя')
    if 'mode===3' not in body and 'mode===2' not in body:
        bad(n + '.html', 'выдача фанта не различает режимы')

# ───────────────── 14. ожидающему нельзя писать «ваш ход» ─────────────────
for n in GAMES:
    js = '\n'.join(scripts(src[n]))
    for mm in re.finditer(r"[^\n]*Ваш ход[^\n]*", js):
        line = js[:mm.start()].count('\n') + 1
        txt = mm.group(0).strip()
        if 'mode' in txt or 'net.seat' in txt or 'mySide' in txt or 'iGuess' in txt or 'notMine' in txt:
            continue
        note(n + '.html', 'строка ~%d: «Ваш ход» без оглядки на режим — %s' % (line, txt[:80]))

# ───────────────── 15. раскладка на любом экране (проверка перед релизом, 28.09.2026) ─────────────────
# «Уменьшить движение»: бесконечная анимация, сжатая до миллисекунды, не замирает,
# а мерцает — у тех самых людей, кто попросил движения поменьше.
for n in ALL:
    i = src[n].find('prefers-reduced-motion: reduce){')
    if i < 0:
        bad(n + '.html', 'нет правила для «Уменьшить движение»')
    elif not re.search(r'animation-iteration-count:\s*1', src[n][i:i + 600]):
        bad(n + '.html', '«Уменьшить движение» без animation-iteration-count:1 — точки ожидания и пульсы мерцают')
# Меню на низком экране (iPhone SE в Safari — 375×548): заставка не сплющивается
# в полоску, подпись не наезжает на список — меню просто прокручивается.
for n in GAMES:
    s_ = src[n]
    if not re.search(r'#menu\{[^}]*overflow-y:auto', s_):
        bad(n + '.html', 'меню не прокручивается — на низком экране низ списка недосягаем')
    if '#menu>*{flex-shrink:0}' not in s_ or not re.search(r'\n\.brand\{flex:1 0 auto', s_):
        bad(n + '.html', 'содержимое меню сжимается — на низком экране заставка сплющится, подпись наедет на список')
    m = re.search(r'\n\.mini\{([^}]*)\}', s_)
    if not m or 'flex:none' not in m.group(1):
        bad(n + '.html', 'заставка .mini без flex:none — на низком экране сплющится')
# Планшет и компьютер: колонка шириной с телефон по центру, шторка итога не шире её.
for n in GAMES:
    s_ = src[n]
    if 'calc((100% - 520px)/2)' not in s_:
        bad(n + '.html', 'на планшете и компьютере список, табло и кнопки растянуты во всю ширину окна')
    m = re.search(r'\n\.sheet\{([^}]*)\}', s_)
    if not m or 'max-width:520px' not in m.group(1):
        bad(n + '.html', 'шторка итога на широком экране во всю ширину')

# ───────────────── итог ─────────────────
print('проверено файлов:', len(ALL) + 2)
if problems:
    print('\nНАЙДЕНО ПРОБЛЕМ:', len(problems))
    for w, t in problems: print('  ✗ %-22s %s' % (w, t))
else:
    print('\nошибок и рассогласований не найдено')
if notes:
    print('\nзаметки:')
    for w, t in notes: print('  · %-22s %s' % (w, t))
sys.exit(1 if problems else 0)
