# -*- coding: utf-8 -*-
"""Все иконки приложения из одной картинки.

   python3 tools/icons.py [исходник.png]

Исходник — готовая квадратная иконка, которую прислал пользователь
(tools/icon-source.png): тёмный фон с мягким градиентом, объёмные руки
и надпись «dvoeplay games». Картинку не перерисовываем — только
подгоняем под то, как её покажет каждая система:

  apple-touch-icon.png   180  на весь квадрат и без прозрачности:
                              углы скругляет сам iPhone
  icon-192.png, icon-512.png  своё скругление 22.5%, углы прозрачные —
                              так её видят компьютер и окно установки
  icon-maskable-512.png  512  лаунчер Android режет её по своей форме
                              (круг, капля, скруглённый квадрат); руки и
                              надпись уменьшены ровно настолько, чтобы
                              целиком лечь в безопасный круг 80%
  favicon.svg                 значок вкладки: только руки — надпись
                              в 16–32 пикселях не читается

Как уменьшить рисунок, не уменьшая фон. Картинка раскладывается на две
части: гладкий фон (многочлен по координатам, подогнанный по пустым
местам вдали от рисунка) и всё остальное — руки, буквы и их мягкие тени.
Уменьшается только вторая часть и кладётся обратно на фон. Тени от рук
тянутся далеко, пикселей на 120, поэтому граница рисунка проведена с
запасом и растушёвана — иначе вокруг рук остался бы видимый ободок.
"""
import base64
import io
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'tools', 'icon-source.png')
OUT = os.path.join(ROOT, 'public')
LUMA = np.array([0.2126, 0.7152, 0.0722])

ROUND = 0.225      # скругление своих иконок, доля стороны
SAFE = 0.40        # радиус безопасного круга maskable-иконки, доля стороны
FAV_HANDS = 0.86   # какую долю ширины значка вкладки занимают руки

src = Image.open(SRC).convert('RGB')
if src.size[0] != src.size[1]:
    sys.exit('исходник должен быть квадратным, а он ' + '×'.join(map(str, src.size)))
N = src.size[0]
K = N / 1024.0                       # все расстояния ниже подобраны для 1024 px
I = np.asarray(src).astype(np.float64)

# ───────── что здесь рисунок, а что фон ─────────
lum = I @ LUMA
sat = I.max(2) - I.min(2)            # цветные буквы «games» по яркости не отличить от фона
ink = ndi.binary_opening((lum > 110) | (sat > 60), iterations=1)
lab, n = ndi.label(ink)
area = ndi.sum(ink, lab, range(1, n + 1))
keep = 1 + np.nonzero(area > N * N * 0.0002)[0]          # соринки не в счёт
ink = np.isin(lab, keep)
hands = lab == keep[np.argmax(area[keep - 1])]           # руки касаются друг друга — самое большое пятно
text = ink & ~hands                                      # остальное — буквы

dist = ndi.distance_transform_edt(~ink)

# ───────── гладкий фон ─────────
yy, xx = np.mgrid[0:N, 0:N].astype(np.float64)


def basis(x, y, deg=4):
    u = x / N * 2 - 1
    v = y / N * 2 - 1
    return np.stack([u ** i * v ** j for i in range(deg + 1) for j in range(deg + 1 - i)], -1)


far = dist > 150 * K                 # дальше 150 px от рисунка теней уже нет
coef = np.linalg.lstsq(basis(xx[far] + .5, yy[far] + .5), I[far], rcond=None)[0]


def background(size):
    """фон всей иконки, пересчитанный на квадрат size×size"""
    g = (np.arange(size) + .5) * N / size
    gx, gy = np.meshgrid(g, g)
    return basis(gx, gy) @ coef


rest = I - background(N)             # руки, буквы, тени и зерно картинки
fit = np.sqrt(((rest[far] @ LUMA) ** 2).mean())


def fade(d, a, b):
    """1 до расстояния a, дальше плавно до 0 к расстоянию b"""
    t = np.clip((d - a) / (b - a), 0, 1)
    return 1 - t * t * (3 - 2 * t)


def to_size(field, box, size):
    """кусок field в границах box (x0, y0, x1, y1 в пикселях исходника) → size×size.
       Поле вне картинки считаем нулём: рисунка там нет."""
    pad = int(N * 0.25)
    out = np.zeros((size, size, 3))
    for c in range(3):
        ch = np.pad(field[..., c], pad).astype(np.float32)
        im = Image.fromarray(ch, mode='F')
        b = tuple(v + pad for v in box)
        out[..., c] = np.asarray(im.resize((size, size), Image.LANCZOS, box=b))
    return out


def rgb(a):
    return Image.fromarray(np.clip(np.round(a), 0, 255).astype(np.uint8), 'RGB')


def rounded(im, radius):
    """прозрачные углы; маска рисуется вчетверо крупнее — край без лесенки"""
    s = im.size[0]
    big = Image.new('L', (s * 4, s * 4), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, s * 4 - 1, s * 4 - 1), radius=radius * 4, fill=255)
    out = im.convert('RGBA')
    out.putalpha(big.resize((s, s), Image.LANCZOS))
    return out


def mec(points):
    """наименьший круг, накрывающий все точки (Велцль, по вершинам выпуклой оболочки)"""
    from scipy.spatial import ConvexHull
    p = points[ConvexHull(points).vertices]
    p = p[np.random.RandomState(7).permutation(len(p))]

    def two(a, b):
        c = (a + b) / 2
        return c, np.linalg.norm(a - c)

    def three(a, b, c):
        d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
        if abs(d) < 1e-9:
            return max((two(a, b), two(a, c), two(b, c)), key=lambda t: t[1])
        sa, sb, sc = a @ a, b @ b, c @ c
        o = np.array([sa * (b[1] - c[1]) + sb * (c[1] - a[1]) + sc * (a[1] - b[1]),
                      sa * (c[0] - b[0]) + sb * (a[0] - c[0]) + sc * (b[0] - a[0])]) / d
        return o, np.linalg.norm(a - o)

    out = lambda q, c, r: np.linalg.norm(q - c) > r + 1e-7
    c, r = p[0], 0.0
    for i in range(1, len(p)):
        if out(p[i], c, r):
            c, r = p[i], 0.0
            for j in range(i):
                if out(p[j], c, r):
                    c, r = two(p[i], p[j])
                    for k in range(j):
                        if out(p[k], c, r):
                            c, r = three(p[i], p[j], p[k])
    return c, r


def corners(mask):
    """углы пикселей рисунка — круг должен накрыть пиксели целиком, а не их центры"""
    y, x = np.nonzero(mask & ~ndi.binary_erosion(mask))
    return np.concatenate([np.stack([x + dx, y + dy], 1) for dx in (0, 1) for dy in (0, 1)]).astype(np.float64)


def png(im):
    """PNG без потерь; если есть oxipng (pip install pyoxipng) — ещё процентов на десять меньше.
       Палитру на 256 цветов не делаем: на цветных буквах «games» проступает зерно."""
    buf = io.BytesIO()
    im.save(buf, format='PNG', optimize=True)
    data = buf.getvalue()
    try:
        import oxipng
        data = oxipng.optimize_from_memory(data, level=6)
    except ImportError:
        pass
    return data


def save(im, name, note):
    data = png(im)
    with open(os.path.join(OUT, name), 'wb') as f:
        f.write(data)
    print('   %-24s %s, %.1f КБ' % (name, note, len(data) / 1024))


print('исходник %s: %d×%d, фон подогнан с точностью %.1f из 255' % (os.path.basename(SRC), N, N, fit))

# ───────── iPhone и свои иконки: картинка как есть ─────────
save(src.resize((180, 180), Image.LANCZOS), 'apple-touch-icon.png', '180×180 во весь квадрат')
for s in (192, 512):
    save(rounded(src.resize((s, s), Image.LANCZOS), s * ROUND), 'icon-%d.png' % s,
         '%d×%d, углы скруглены' % (s, s))

# ───────── maskable: рисунок в безопасный круг, фон во весь квадрат ─────────
M = 512
(cx, cy), r = mec(corners(ink))
scale = SAFE * N * 0.98 / r          # 2% запаса, чтобы край букв не лёг ровно на границу
drawing = fade(dist, 100 * K, 170 * K)[..., None] * rest
half = N / 2 / scale                 # полстороны итогового квадрата в пикселях исходника
mask_img = background(M) + to_size(drawing, (cx - half, cy - half, cx + half, cy + half), M)
save(rgb(mask_img), 'icon-maskable-512.png',
     'рисунок %.0f%% от исходника, круг рисунка %.1f%% стороны' % (scale * 100, r * scale / N * 100))

# ───────── значок вкладки: только руки ─────────
T = 96                               # вкладка 16 px на экране с тройной плотностью — это 48 точек, берём вдвое
dh = ndi.distance_transform_edt(~hands)
dt = ndi.distance_transform_edt(~text)
side = fade(dh - dt, -30 * K, 10 * K)   # поближе к буквам, чем к рукам, — уже не руки
only_hands = (fade(dh, 100 * K, 170 * K) * side)[..., None] * rest
hy, hx = np.nonzero(hands)
hw = hx.max() + 1 - hx.min()
hcx, hcy = (hx.min() + hx.max() + 1) / 2, (hy.min() + hy.max() + 1) / 2
half = hw / FAV_HANDS / 2
fav = background(T) + to_size(only_hands, (hcx - half, hcy - half, hcx + half, hcy + half), T)
fav = rounded(rgb(fav), T * ROUND)
data = base64.b64encode(png(fav)).decode('ascii')
# Файл остаётся SVG: на favicon.svg ссылаются все девять страниц и офлайн-кеш.
# Внутри — готовая картинка: объёмные руки в вектор без потерь не перевести.
svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">'
       '<image width="%d" height="%d" href="data:image/png;base64,%s"/></svg>\n') % (T, T, T, T, T, T, data)
with open(os.path.join(OUT, 'favicon.svg'), 'w') as f:
    f.write(svg)
print('   %-24s %d×%d, только руки, %.1f КБ' % ('favicon.svg', T, T, len(svg) / 1024))
