// Independently implemented from the public Corbel demo's observable motion.
// Presentation only: this module never reads financial data or calls a service.
(function () {
  'use strict';
  const shell = window.WBShell;
  if (!shell) return;
  const root = document.documentElement;
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const expo = 'cubic-bezier(.16,1,.3,1)';
  const power = 'cubic-bezier(.22,.61,.36,1)';
  const back = 'cubic-bezier(.34,1.56,.64,1)';
  const live = new WeakMap();
  const closingModals = new Map();
  let navigation = 0, lastView = '', themeTransition = null;

  function animate(node, frames, options = {}) {
    if (!node || !node.animate || reduced()) return null;
    live.get(node)?.cancel();
    const animation = node.animate(frames, { duration: 600, easing: power, ...options });
    live.set(node, animation);
    animation.finished.catch(() => {}).finally(() => {
      // A filled exit still owns opacity/transform after its promise resolves.
      // Keep that handle until its owner explicitly cancels it after commit.
      if (live.get(node) === animation && (options.fill !== 'forwards' || animation.playState === 'idle')) {
        animation.cancel(); live.delete(node);
      }
    });
    return animation;
  }
  function cancel(nodes) { nodes.forEach(node => live.get(node)?.cancel()); }
  function entrance(nodes, { x = 0, y = 26, duration = 900, stagger = 70, delay = 0, scale = .985 } = {}) {
    nodes.filter(node => node.getClientRects().length).slice(0, 24).forEach((node, i) => {
      animate(node, [{ opacity: 0, transform: `translate(${x}px,${y}px) scale(${scale})` },
        { opacity: 1, transform: 'none' }], { duration, delay: delay + Math.min(i * stagger, 280), easing: expo, fill: 'backwards' });
    });
  }

  // Corbel's masked, letter-by-letter heading: 800ms + 20ms per character.
  function heading() {
    const title = document.getElementById('pageTitle');
    if (!title || reduced()) return;
    const text = title.textContent;
    title.setAttribute('aria-label', text);
    title.replaceChildren();
    let index = 0;
    text.split(' ').forEach((word, wordIndex) => {
      if (wordIndex) title.append(document.createTextNode(' '));
      const mask = document.createElement('span'); mask.className = 'motion-word'; mask.setAttribute('aria-hidden', 'true');
      [...word].forEach(char => {
        const glyph = document.createElement('span'); glyph.className = 'motion-letter'; glyph.textContent = char; mask.append(glyph);
        animate(glyph, [{ transform: 'translateY(110%) rotate(5deg)' }, { transform: 'none' }],
          { duration: 800, delay: Math.min(index++ * 20, 300), easing: expo, fill: 'backwards' });
      });
      title.append(mask);
    });
  }

  const rails = new Map();
  function indicator(container, selected, animated, vertical = false) {
    if (!selected || !container.getClientRects().length) return;
    let state = rails.get(container);
    if (!state) {
      const pill = document.createElement('span'); pill.className = vertical ? 'motion-nav-pill' : 'motion-tab-pill';
      pill.setAttribute('aria-hidden', 'true'); container.prepend(pill); state = { pill, top: 0, left: 0 }; rails.set(container, state);
      container.classList.add('motion-tracked');
    }
    const { pill } = state, top = selected.offsetTop, left = selected.offsetLeft;
    const previous = { top: state.top, left: state.left, width: pill.offsetWidth, height: pill.offsetHeight };
    Object.assign(pill.style, { top: `${top}px`, left: `${left}px`, width: `${selected.offsetWidth}px`, height: `${selected.offsetHeight}px` });
    if (animated && previous.width) {
      const distance = previous.top - top;
      animate(pill, [{ transform: `translate(${previous.left - left}px,${distance}px) scale${vertical ? 'Y' : 'X'}(${vertical ? 1 + Math.min(.55, Math.abs(distance) / 260) : 1.15})` },
        { transform: 'none' }], { duration: vertical ? 650 : 550, easing: expo });
      if (vertical && distance) animate(selected.querySelector('.icon'),
        [{ transform: `scale(.7) rotate(${distance < 0 ? 14 : -14}deg)` }, { transform: 'none' }], { duration: 600, delay: 80, easing: back });
    }
    state.top = top; state.left = left;
  }
  function syncIndicators(animated = true) {
    document.querySelectorAll('.side-menu').forEach(nav => indicator(nav, nav.querySelector('a.active'), animated, true));
    document.querySelectorAll('.segmented-control,.settings-tabs').forEach(group => {
      indicator(group, group.querySelector('button.active,a[aria-current="page"]'), animated);
    });
  }
  function enter(view) {
    ++navigation;
    cancel([...document.querySelectorAll('.app-view.is-active')]);
    syncIndicators();
    if (view === lastView) return;
    lastView = view; heading();
    entrance([...document.querySelectorAll('.app-view.is-active')], { y: 26, stagger: 70 });
    const main = document.querySelector('.app-main');
    if (main) main.setAttribute('data-motion-view', view);
  }
  // An interruptible 200ms exit, then the actual existing router commit.
  // Only the latest click can commit. Never animate old data over new shop data.
  function navigate(commit) {
    const id = ++navigation, nodes = [...document.querySelectorAll('.app-view.is-active')];
    cancel(nodes);
    if (reduced() || !nodes.length) { commit(); return; }
    const exits = nodes.map(node => animate(node, [{ opacity: 1, transform: 'none' },
      { opacity: 0, transform: 'translateY(-10px)' }], { duration: 200, easing: 'cubic-bezier(.55,.085,.68,.53)', fill: 'forwards' }));
    Promise.all(exits.map(a => a?.finished.catch(() => {}))).then(() => {
      if (id !== navigation) return;
      cancel(nodes); commit();
    });
  }
  // Exact demo mechanism: a 620ms circle from the appearance button.
  function theme(next, button, commit) {
    if (reduced() || !document.startViewTransition) { commit(); return; }
    themeTransition?.skipTransition();
    const box = button.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    root.classList.add('motion-theme');
    const transition = document.startViewTransition(commit); themeTransition = transition;
    transition.ready.then(() => {
      if (themeTransition !== transition) return;
      root.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 620, easing: 'cubic-bezier(.65,0,.35,1)', pseudoElement: '::view-transition-new(root)' });
    }).catch(() => {});
    transition.finished.catch(() => {}).finally(() => { if (themeTransition === transition) { root.classList.remove('motion-theme'); themeTransition = null; } });
    animate(button.querySelector('svg:not([hidden])'), [{ transform: 'rotate(-90deg) scale(.6)' }, { transform: 'none' }], { duration: 600, easing: back });
  }

  function hideModal(modal) {
    if (closingModals.has(modal)) return;
    const card = modal.querySelector('.modal-card');
    cancel([modal, card]);
    if (reduced()) { modal.hidden = true; return; }
    const finish = () => { modal.hidden = true; closingModals.delete(modal); cancel([modal, card]); };
    closingModals.set(modal, finish);
    const phone = window.matchMedia('(max-width:600px)').matches;
    animate(modal, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
    const exit = animate(card, [{ opacity: 1, transform: 'none' }, phone
      ? { opacity: 1, transform: 'translateY(100%)' }
      : { opacity: 0, transform: 'translateY(12px) scale(.97)' }],
    { duration: phone ? 320 : 200, easing: 'cubic-bezier(.55,.085,.68,.53)', fill: 'forwards' });
    if (exit) exit.finished.then(finish).catch(() => {
      if (reduced()) finish(); else closingModals.delete(modal);
    });
    else finish();
  }

  function settleReducedMotion() {
    // Honor requested closes before cancelling their visual exit promises.
    [...closingModals.values()].forEach(finish => finish());
    document.getAnimations().forEach(animation => animation.cancel());
    themeTransition?.skipTransition();
  }

  function wire() {
    const screen = document.getElementById('appScreen'), sidebar = document.getElementById('mobileSidebar');
    const railButton = document.getElementById('sidebarCollapse');
    const updateRailButton = () => {
      const collapsed = root.classList.contains('sidebar-compact');
      railButton?.setAttribute('aria-pressed', String(collapsed));
      railButton?.setAttribute('aria-label', collapsed ? 'Развернуть боковое меню' : 'Свернуть боковое меню');
    };
    try { if (localStorage.getItem('seller-sidebar-compact') === '1') root.classList.add('sidebar-compact'); } catch (_) { /* optional storage */ }
    const toggleRail = () => {
      if (window.matchMedia('(max-width:900px)').matches) return;
      const commit = () => {
        root.classList.toggle('sidebar-compact'); updateRailButton(); syncIndicators(false);
        try { localStorage.setItem('seller-sidebar-compact', root.classList.contains('sidebar-compact') ? '1' : '0'); } catch (_) { /* optional storage */ }
      };
      if (!reduced() && document.startViewTransition && !themeTransition) {
        root.classList.add('motion-rail');
        document.startViewTransition(commit).finished.catch(() => {}).finally(() => root.classList.remove('motion-rail'));
      } else commit();
    };
    railButton?.addEventListener('click', toggleRail); updateRailButton();
    document.addEventListener('keydown', e => {
      if (e.key === '[' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest('input,textarea,select,[contenteditable]')) { e.preventDefault(); toggleRail(); }
    });
    document.querySelectorAll('.side-menu a,.sidebar-action').forEach(link => { link.title = link.textContent.trim(); link.setAttribute('aria-label', link.textContent.trim()); });
    document.querySelectorAll('.side-menu').forEach(nav => {
      const hover = document.createElement('span'); hover.className = 'motion-nav-hover'; hover.setAttribute('aria-hidden','true'); nav.prepend(hover);
      let previousTop = null;
      nav.addEventListener('pointerover', e => {
        const link = e.target.closest('a');
        if (!link || !window.matchMedia('(hover:hover)').matches) return;
        const top = link.offsetTop, oldTop = previousTop;
        Object.assign(hover.style,{top:`${top}px`,left:`${link.offsetLeft}px`,width:`${link.offsetWidth}px`,height:`${link.offsetHeight}px`,opacity:link.classList.contains('active')?'0':'1'});
        if (oldTop !== null && oldTop !== top) animate(hover,[{transform:`translateY(${oldTop-top}px)`},{transform:'none'}],{duration:420,easing:power});
        previousTop = top;
      });
      nav.addEventListener('pointerleave',()=>{hover.style.opacity='0';previousTop=null;});
    });
    const groups = [...document.querySelectorAll('.side-menu,.segmented-control,.settings-tabs')];
    groups.forEach(group => new MutationObserver(() => syncIndicators()).observe(group, { subtree: true, attributes: true, attributeFilter: ['aria-current', 'aria-pressed', 'class'] }));
    if (typeof ResizeObserver !== 'undefined') {
      const resize = new ResizeObserver(() => syncIndicators(false)); groups.forEach(group => resize.observe(group));
    }
    let introDone = false, menuWasOpen = false;
    function screenChanged() {
      if (!screen) return;
      if (!screen.hidden && !introDone) {
        introDone = true;
        entrance([document.querySelector('.app-main')], { y: 22, scale: .988, duration: 1100, stagger: 0 });
        entrance([...document.querySelectorAll('.sidebar-brand,.shop-context')], { x: -16, y: 0, duration: 800, stagger: 60, delay: 50 });
        entrance([...document.querySelectorAll('.side-menu a')], { x: -14, y: 0, duration: 700, stagger: 22, delay: 150 });
        entrance([...document.querySelectorAll('.shell-actions>*')], { y: -8, scale: .9, duration: 600, stagger: 50, delay: 300 });
        syncIndicators(false);
      }
      const open = screen.classList.contains('menu-open');
      if (open && !menuWasOpen) entrance([...document.querySelectorAll('.side-menu a')], { x: -12, y: 0, scale: 1, duration: 600, stagger: 18, delay: 50 });
      menuWasOpen = open;
    }
    if (screen) new MutationObserver(screenChanged).observe(screen, { attributes: true, attributeFilter: ['hidden', 'class'] });
    screenChanged();
    // Modal visibility remains owned by the existing form handlers. Only enter
    // the surface here; closing never delays security/data state changes.
    document.querySelectorAll('.modal-backdrop').forEach(modal => {
      new MutationObserver(() => {
        if (modal.hidden) { cancel([modal, modal.querySelector('.modal-card')]); return; }
        const phone = window.matchMedia('(max-width:600px)').matches;
        animate(modal, [{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
        animate(modal.querySelector('.modal-card'), phone
          ? [{ transform: 'translateY(100%)' }, { transform: 'none' }]
          : [{ opacity: 0, transform: 'translateY(18px) scale(.96)' }, { opacity: 1, transform: 'none' }],
        { duration: phone ? 550 : 500, easing: phone ? expo : back });
      }).observe(modal, { attributes: true, attributeFilter: ['hidden'] });
    });
    document.addEventListener('pointerover', e => {
      const button = e.target.closest('.help-button');
      if (button && !button.contains(e.relatedTarget)) animate(button.closest('.metric-help')?.querySelector('.help-popover'),
        [{ opacity: 0, transform: 'translateY(-8px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 400, easing: back });
    });
    // Stop spatial animations immediately if the user enables reduced motion.
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', e => {
      if (e.matches) settleReducedMotion();
    });
    document.fonts?.ready.then(() => syncIndicators(false));
    syncIndicators(false);
  }
  shell.motion = { enter, navigate, theme, hideModal, syncIndicators, settleReducedMotion };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire, { once: true }); else wire();
})();
