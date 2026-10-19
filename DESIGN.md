---
name: "Панель продавца — Corbel adaptation"
description: "Плотная финансовая среда с лавандовой навигацией, вложенным полотном и двумя темами."
colors:
  light-page: "#dfe4f4"
  light-panel: "#f6f7f9"
  light-surface: "#fff"
  light-surface-2: "#f2f4f7"
  light-line: "#161b3017"
  light-line-strong: "#161b3029"
  light-ink: "#161b30"
  light-ink-soft: "#4b5168"
  light-ink-mute: "#676d84"
  light-brand: "#161b30"
  light-brand-soft: "#2a45cc"
  light-accent: "#2a45cc"
  light-accent-soft: "#e4e9fb"
  light-good: "#2b7a64"
  light-good-bg: "#e0efe9"
  light-bad: "#b0412b"
  light-bad-bg: "#f7e6e1"
  light-violet: "#7a5aa6"
  light-violet-bg: "#efe9f6"
  light-warm: "#946415"
  light-warm-bg: "#f8eeda"
  light-on-brand: "#fff"
  light-chart-grid: "#161b3017"
  dark-page: "#0f1430"
  dark-panel: "#10131f"
  dark-surface: "#161a29"
  dark-surface-2: "#1c2133"
  dark-line: "#e1e6fa17"
  dark-line-strong: "#e1e6fa2b"
  dark-ink: "#e9ecf7"
  dark-ink-soft: "#b1b8d0"
  dark-ink-mute: "#9aa3bf"
  dark-brand: "#dce3ff"
  dark-brand-soft: "#a9b6f4"
  dark-accent: "#7088f0"
  dark-accent-soft: "#7088f026"
  dark-good: "#6fd0b2"
  dark-good-bg: "#6fd0b221"
  dark-bad: "#f08c78"
  dark-bad-bg: "#f08c7821"
  dark-violet: "#b39bd6"
  dark-violet-bg: "#b39bd621"
  dark-warm: "#e4bd75"
  dark-warm-bg: "#e4bd751c"
  dark-on-brand: "#10131f"
  dark-chart-grid: "#e1e6fa17"
typography:
  headline:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "23px"
    fontWeight: 750
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "14px"
    lineHeight: 1.5
    letterSpacing: "-0.015em"
  label:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 550
    lineHeight: 1.5
  metric:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "clamp(22px, 2.15vw, 32px)"
    fontWeight: 750
    lineHeight: 1.18
    letterSpacing: "-0.035em"
rounded:
  control: "9px"
  nav: "12px"
  card: "16px"
  modal: "18px"
  canvas: "26px"
spacing:
  tight: "4px"
  compact: "8px"
  control-gap: "12px"
  field-gap: "16px"
  card-gap: "20px"
  section-gap: "24px"
components:
  button-primary:
    backgroundColor: "{colors.light-brand}"
    textColor: "{colors.light-on-brand}"
    rounded: "{rounded.control}"
  button-primary-dark:
    backgroundColor: "{colors.dark-brand}"
    textColor: "{colors.dark-on-brand}"
    rounded: "{rounded.control}"
  button-primary-hover:
    backgroundColor: "{colors.light-accent}"
    textColor: "{colors.light-on-brand}"
  button-ghost:
    backgroundColor: "{colors.light-surface}"
    textColor: "{colors.light-ink}"
    rounded: "{rounded.control}"
  input:
    backgroundColor: "{colors.light-surface}"
    textColor: "{colors.light-ink}"
    rounded: "{rounded.control}"
  nav:
    textColor: "{colors.light-ink-soft}"
    rounded: "{rounded.nav}"
    padding: "5px 10px"
  chip-up:
    backgroundColor: "{colors.light-good-bg}"
    textColor: "{colors.light-good}"
    padding: "2px 6px"
  card:
    backgroundColor: "{colors.light-surface}"
    rounded: "{rounded.card}"
  kpi-selected:
    backgroundColor: "{colors.light-accent-soft}"
    textColor: "{colors.light-ink}"
    padding: "19px 20px 17px"
  appearance-selected:
    backgroundColor: "{colors.light-accent-soft}"
    textColor: "{colors.light-accent}"
    rounded: "{rounded.control}"
    padding: "14px"
---

# Design System: Панель продавца

## Overview

**Creative North Star: "Вложенное финансовое полотно"**

Спокойная, плотная рабочая среда: лавандовая навигационная полоса обрамляет отдельное скруглённое полотно, а индиго отмечает выбор. Светлая и тёмная темы равноправны; иерархия строится на тоне поверхности, границах и типографике. Это одобренная замена прежней светлой Apple-стилистики.

Ориентир — закреплённый [Corbel dashboard](https://demo.codeandchill.store/corbel/#/dashboard), направление — [.impeccable/surfaces/app-html.md](.impeccable/surfaces/app-html.md). Адаптация написана самостоятельно, непосредственно в коде; платный исходник шаблона не импортировался. Документ фиксирует реализованную систему платформы без утверждения точного клонирования Corbel. Продуктовые ограничения, текущие API и файловая поддержка Ozon определяются [CONTEXT.md](CONTEXT.md).

Источники фиксации от 19 октября 2026: assets/corbel.css, assets/corbel.js, app.html, общий assets/dashboard.js и наследуемые assets/styles.css, assets/responsive.css. Просмотрены .impeccable/review/desktop.jpg, account-desktop-dark.jpg (1440×1000), overview-mobile-dark.jpg, costs-mobile-dark.jpg (390×844). Снимки содержат тестовые данные и подтверждают только показанные визуальные состояния. Это не независимая проверка входа, финансов или живых API. По сообщению основного исполнителя оба замечания ревью получили resolved и disposition ship в пределах двух исправлений. Правила фона заголовка SKU и наведённых строк подтверждены в CSS; документационный проход не повторял проверку исправлений и не расширяет scoped ship до полной функциональной проверки.

**Key Characteristics:**

- Вложенное полотно, тонкие границы, плоские рабочие поверхности.
- Manrope для кириллицы, латиницы, чисел и графиков.
- Общая панель KPI с выделением выбранной метрики.
- Две темы с локальным выбором и сохранением исходных данных.

## Colors

Frontmatter воспроизводит значения CSS без пересчёта цвета и альфы. Префиксы light- и dark- — варианты одного свойства: dark-accent-soft соответствует --accent-soft при html[data-theme="dark"]. Базовая тема — light. Компонентные токены без суффикса темы описывают light; snippets sidecar наследуют семантические CSS-переменные текущей темы.

### Primary

Индиго (accent) обозначает активные иконки, фокус, ссылки и выбор метрики; accent-soft даёт фон выбранного состояния. Основная кнопка использует отдельную пару brand / on-brand, при наведении — accent с белым текстом. brand-soft сохранён как реально объявленный семантический токен.

### Secondary

Нефрит (good / good-bg) и терракота (bad / bad-bg) показывают полезное и неблагоприятное изменение. Фиолетовый (violet / violet-bg) и охра (warm / warm-bg) различают разделы, метрики и предупреждения. Рост расходов считается неблагоприятным: направление стрелки не определяет цвет само по себе.

### Neutral

page — внешнее поле и rail; panel — вложенное полотно; surface — карточки; surface-2 — вторичные участки, поля себестоимости и заголовки таблиц. ink, ink-soft, ink-mute задают три уровня текста. line отделяет строки, line-strong обрамляет поверхности, chart-grid задаёт сетку графиков.

**The Theme Pair Rule.** Каждый фон, текст, граница и состояние используют семантическую пару светлой и тёмной темы; светлая заливка таблицы не переносится в тёмную тему литералом.

## Typography

Единственное семейство — локальный Manrope со стеком Manrope, system-ui, sans-serif. --font-data ссылается на --font-sans; финансовые колонки используют tabular-nums, существующие числовые стили также lining-nums. Отдельное моноширинное семейство не вводится.

assets/fonts/manrope-cyrillic.woff2 и manrope-latin.woff2 объявлены через @font-face с весами 400–800 и font-display: swap; кириллическое объявление содержит unicode-range. Лицензия SIL OFL 1.1 находится в assets/fonts/OFL-Manrope.txt. Внешний шрифтовой сервис не требуется.

Иерархия frontmatter задаёт desktop-заголовок (23 px), секцию (16 px), текст (14 px), подпись KPI (12 px) и метрику. Заголовок страницы уменьшается до 22 px при ≤900 px и 20 px при ≤600 px; секция — до 15 px при ≤900 px. Второй ряд KPI при >1100 px использует 27 px; 901–1100 px — 23 px; 601–900 px — 26 px. На телефоне метрика использует clamp(18px, 5.15vw, 27px). Сумма и единица не разрываются.

Общие поля при ≤600 px переходят на 16 px; селектор периода имеет отдельное правило 14 px. Chart.js получает семейство из вычисленного стиля body, базовый размер — 12 px. Размер 11 px остаётся для компактных desktop-дельт, единиц и заголовков таблиц; мобильные пояснения KPI и дельты увеличиваются до 12 px. Эти размеры не являются разрешением уменьшать любой вспомогательный текст.

## Layout

Desktop-rail имеет ширину 264 px. Полотно начинается с отступом сверху/снизу 8 px и справа 10 px, радиусом canvas, внутренним отступом 24 px по горизонтали и 32 px снизу. Старый предел ширины 1440 px отменён; при ≥1900 px горизонтальный отступ — 36 px. Заголовок и действия стоят в строке, панель площадки и месяца — на следующей полной строке.

| Viewport | Навигация и полотно | KPI |
| --- | --- | --- |
| >1100 px | Постоянный rail 264 px | 20 треков: первые четыре KPI по 5 треков, последующие по 4; полный набор даёт 4+5 |
| 901–1100 px | Rail 228 px, отступ полотна 20 px | Три колонки |
| 601–900 px | Drawer 264 px, сплошной toolbar 60 px, отступ полотна 18 px | Три колонки |
| ≤600 px | Полотно во всю ширину, отступ 14 px, safe area сверху | Две колонки; последняя нечётная карточка занимает всю строку |

Количество KPI зависит от данных: Ozon скрывает медийную рекламу, нулевые промобонусы не показываются. Не добавлять фиктивные карточки ради 4+5. Чистая прибыль остаётся внутри общей панели, без отдельной двойной hero-плитки.

До 1650 px расходы и SKU стоят вертикально; от 1650 px двухколоночная аналитика использует .8fr / 1.5fr с минимумом 340 px у первого блока. Межкарточный интервал — 20 px, между секциями — 24 px (22 px на телефоне). График динамики имеет высоту 305 px, на телефоне — 235 px.

Наследуемый SKU-список при ≤760 px превращается в подписанные строки с метриками 2×2; себестоимость и служебные таблицы при ≤600 px становятся вертикальными строками. Длинные артикулы и названия переносятся. Профиль при ≤900 px складывается в одну колонку, его поля — при ≤600 px.

## Elevation & Depth

Рабочие карточки, KPI и загрузки плоские: --shadow: none, без backdrop blur. Глубину создают page/panel/surface и тонкие границы. Маленькая тень выбранного сегмента (0 1px 3px #161b3014) обозначает контроль.

Подсказка использует 0 15px 40px -15px #0005, модальное окно — 0 24px 70px -20px #0006; подложка модального окна — #0b102a70 с blur 3 px. Авторизация имеет отдельную тень 0 24px 70px -35px #161b3044. Эти исключения не переносятся на KPI.

**The Framed Canvas Rule.** Рабочие поверхности различаются тоном и границей; тень применяется только к существующим сегментам и перекрывающим слоям.

## Shapes

Карточки и общая панель KPI используют радиус card; поля и обычные кнопки — control; строки навигации — nav. Полотно уменьшается с 26 px до 20 px при ≤900 px и до верхних углов 18 px при ≤600 px. Мобильная панель KPI имеет радиус 12 px; отдельные ячейки имеют прямые внутренние углы. Модальное окно — 18 px. Аватары и верхние иконки круглые.

## Components

### Buttons

Основные и вторичные кнопки имеют минимум 40 px по высоте, радиус control, без тени. Вторичная кнопка использует surface / line-strong, при наведении — surface-2 / ink-mute. Нажатие обычной кнопки даёт смещение вниз 1 px; disabled — opacity .45, not-allowed. Для верхних темы и профиля заданы круглые размеры 36×36 px; у кнопки темы на телефоне также действует наследуемый min-height 44 px. Локальные правила размеров не являются обещанием общего минимума 44 px для всех контролов.

### Inputs / Fields

Поле имеет surface, ink, границу line-strong 1 px и минимум 40 px. Фокус меняет границу на accent и добавляет 0 0 0 3px var(--accent-soft). Общий :focus-visible — accent-контур 2 px с отступом 3 px. Readonly-профиль использует surface-2 / ink-soft; числовое поле себестоимости — surface-2 / ink с локальными размерами из основной таблицы.

### Navigation

Строки высотой минимум 42 px, отступ 5×10 px, зазор 11 px, иконка 28×28 px. Активная строка использует color-mix поверхности (62%) и границы accent (22%); иконка — accent с белым рисунком. Hover смешивает поверхность на 45%. Разделы различаются цветными подложками иконок. Drawer закрывается по подложке и Escape с возвратом фокуса; в закрытом состоянии имеет inert.

### Chips and selection

Дельты: радиус 5 px, отступ 2×6 px, пары good/good-bg или bad/bad-bg; нейтральная — surface-2 / ink-soft. ABC: good для A, accent для B, нейтральная поверхность для C. Переключатель площадки имеет общий трек и surface у активного сегмента. Выбор темы использует accent-границу, accent-soft фон и aria-pressed.

### Cards / Containers and uploads

Карточка — surface, line-strong, радиус card. Тренд имеет отступ 20×22×16 px; профиль — 24 px; настройки — 20 px. Dropzone имеет штриховую границу, минимум 210 px (190 px на телефоне); hover и dragover дают accent-soft и accent-границу без подъёма. Реальные инструкции и ссылки на источники файлов сохраняются.

### Connected KPI panel and graphs

Показатели объединены общей границей и разделителями. Выбранный KPI имеет accent-soft и нижнюю внутреннюю линию accent 2 px; hover — surface-2 без смещения. Интерактивный KPI — кнопка с aria-pressed и aria-controls, выбор меняет существующий тренд. Unknown остаётся прочерком, отсутствующие точки не соединяются (spanGaps: false).

Тренд по умолчанию линейный с полупрозрачной заливкой; переключатель выбирает столбцы. Основные суммы используют accent, прибыль — good, медийная реклама и ДРР выкупа — violet, ДРР заказа — warm. Линия имеет толщину 2.5 px и tension .38; единичные точки видны. Кольцевая диаграмма расходов имеет cutout 78%, radius 88%, разделители surface. Категориальная палитра расходов задана отдельно в dashboard.js. SKU-график получает цвета ABC из good, accent и ink-mute при создании; обработчик смены темы не пересчитывает его цвета категорий.

seller:themechange обновляет подписи, сетку, разделители doughnut и наборы тренда с sellerMetric, затем вызывает chart.update('none') без чтения финансов. То же обновление происходит после document.fonts.ready. Категории расходов и SKU сохраняют цвета текущего набора данных до его пересоздания; tooltip тренда сохраняет собственную тёмную подложку.

### SKU and cost tables

Заголовки обеих таблиц используют surface-2 / ink-soft, футер — surface-2. Правило .corbel .sku-card table.sku thead th перекрывает старую светлую заливку и убирает backdrop blur. Правила .corbel .sku-card table.sku tbody tr:hover и ... tr:hover td используют surface-2; себестоимость при наведении — accent-soft. Эти специфичные состояния действуют и в dark. На телефоне SKU-строки используют surface / surface-2; себестоимость — подписанные блоки с полем и действием.

### Account and appearance

Имя и Telegram приходят из метаданных текущей сессии; аватар содержит инициалы. app.html вычисляет роль по shop.owner_id === session.user.id и передаёт её в WBShell.setProfile. Роль выбранного магазина и поля личности readonly; декоративной подстановки владельца или кнопки сохранения личности нет. Telegram-ссылка показывается только при допустимом username. Имя меняется в Telegram с повторным входом.

Тема сразу применяется к html[data-theme], сохраняется только в localStorage seller-appearance, синхронизирует контролы и theme-color. Без допустимого сохранённого значения используется light; автоматический выбор по системе не реализован. Ошибка хранилища не мешает применить тему в текущем сеансе. Записи аккаунта и ключей API при выборе темы нет.

### Motion

Переходы кнопок — 200 ms; drawer и вход секции — 280 ms с cubic-bezier(.16,1,.3,1). Вход секции использует смещение 5 px и blur 1 px. Числа KPI и тренд — 720 ms, расходы — 760 ms, SKU-график — 680 ms с easeOutQuart. prefers-reduced-motion: reduce отключает CSS-переходы и вход секций, сразу ставит конечное число, отключает анимацию графиков и делает прокрутку к тренду мгновенной. Это описание кода, не полная проверка всех анимаций приложения.

## Do's and Don'ts

### Do:

- **Do** Использовать парные семантические токены для обеих тем, включая заголовки и наведение таблиц.
- **Do** Сохранять общее полотно, связанную сетку KPI и адаптивные размеры из реализации.
- **Do** Использовать локальный Manrope для кириллицы, латиницы, чисел и подписей графиков.
- **Do** Показывать реальные Telegram-данные и роль выбранного магазина в readonly-профиле.
- **Do** Сохранять загрузку, ошибки, неизвестные значения и reduced-motion при развитии интерфейса.

### Don't:

- **Don't** Возвращать обязательную светлую Apple-стилистику или отдельную декоративную hero-плитку прибыли.
- **Don't** Добавлять вымышленные показатели, карточки или редактирование аккаунта ради сходства с демо.
- **Don't** Сохранять оформление как серверную настройку аккаунта или перезапрашивать финансы при смене темы.
- **Don't** Расширять вердикт ship по двум исправлениям до полной функциональной проверки или точного клонирования Corbel.
