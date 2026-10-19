import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Small DOM double: exercises the shipped module and its real event/observer
// callbacks without a browser, external dependencies, or application changes.
const source = readFileSync(new URL('../assets/corbel-components.js', import.meta.url), 'utf8');

class Element {
  constructor() {
    this.children = []; this.attrs = new Map(); this.dataset = {}; this.style = {};
    this.handlers = new Map(); this.hidden = false; this.disabled = false;
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => classes.add(name)),
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
    };
  }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  hasAttribute(name) { return this.attrs.has(name); }
  removeAttribute(name) { this.attrs.delete(name); }
  append(...nodes) { nodes.forEach(node => { node.parentElement = this; this.children.push(node); }); }
  before(node) { this.wrapper = node; }
  replaceChildren() { this.children = []; }
  insertAdjacentHTML() {}
  get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this.text || ''; }
  set textContent(value) { this.text = value; }
  querySelectorAll(selector) {
    assert.equal(selector, '[role=option]');
    return this.children.filter(child => child.getAttribute('role') === 'option');
  }
  addEventListener(type, handler) {
    const list = this.handlers.get(type) || []; list.push(handler); this.handlers.set(type, list);
  }
  dispatchEvent(event) { (this.handlers.get(event.type) || []).forEach(handler => handler(event)); }
  focus() { this.dispatchEvent({ type: 'focus' }); }
  scrollIntoView() {}
  getBoundingClientRect() { return { left: 20, top: 20, bottom: 60, width: 220, height: 40 }; }
}

function fixture(hidden = false) {
  const select = new Element(), group = new Element(), observers = [], changes = [];
  select.hidden = hidden;
  const options = ['A', 'B', 'C'].map(text => {
    const option = new Element(); option.textContent = text; return option;
  });
  select.append(options[0], options[1], group); group.append(options[2]);
  select.options = options;
  Object.defineProperties(select, {
    selectedIndex: {
      get: () => options.findIndex(option => option.selected),
      set: index => options.forEach((option, i) => { option.selected = i === index; }),
    },
    selectedOptions: { get: () => options.filter(option => option.selected) },
  });
  select.selectedIndex = 1;
  for (const type of ['input', 'change']) select.addEventListener(type, () => changes.push(type));
  const body = new Element(), shell = {};
  const document = {
    readyState: 'complete', body, createElement: () => new Element(),
    getElementById: () => null, querySelector: () => null,
    querySelectorAll: selector => { assert.equal(selector, 'select'); return [select]; },
    addEventListener() {},
  };
  vm.runInNewContext(source, {
    document, innerWidth: 1440, innerHeight: 900,
    window: { WBShell: shell, matchMedia: () => ({ matches: true }), addEventListener() {} },
    Event: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe(target, config) { observers.push({ target, config, callback: this.callback }); }
    },
  });
  const wrap = select.wrapper, button = wrap.children[1], menu = body.children[0];
  const notify = attribute => {
    const observer = observers.find(entry => entry.target === select);
    assert.ok(observer.config.subtree, 'option/group mutations must be observed');
    assert.ok(observer.config.attributeFilter.includes(attribute), `${attribute} must trigger synchronization`);
    observer.callback();
  };
  const key = key => button.dispatchEvent({ type: 'keydown', key, preventDefault() {} });
  const open = () => button.dispatchEvent({ type: 'click' });
  const active = () => menu.children.find(item => item.id === button.getAttribute('aria-activedescendant'));
  return { select, options, group, wrap, button, menu, changes, notify, key, open, active };
}

// The original index regression: hiding A must not turn highlighted B into C.
const identity = fixture();
identity.open();
assert.equal(identity.active().textContent, 'B');
identity.options[0].hidden = true; identity.notify('hidden');
assert.equal(identity.active().textContent, 'B', 'highlight follows native option identity after redraw');
identity.key('Enter');
assert.equal(identity.select.selectedIndex, 1, 'Enter keeps B after an earlier option disappears');
assert.deepEqual(identity.changes, [], 'unchanged selection must not fire native change handlers');
identity.open(); identity.key('End'); identity.key('Enter');
assert.equal(identity.select.selectedIndex, 2);
assert.deepEqual(identity.changes, ['input', 'change'], 'changed selection preserves original native handlers');

// Reconcile to selected/first enabled, then clear references when none remain.
const fallback = fixture(); fallback.open(); fallback.key('End');
fallback.group.hidden = true; fallback.notify('hidden');
assert.deepEqual(fallback.menu.children.map(item => item.textContent), ['A', 'B'], 'hidden groups expose no options');
assert.equal(fallback.active().textContent, 'B', 'hidden active option falls back to the selected option');
fallback.options[1].disabled = true; fallback.notify('disabled');
assert.equal(fallback.active().textContent, 'A', 'disabled selected option falls back to first enabled');
fallback.options[0].disabled = true; fallback.notify('disabled');
assert.equal(fallback.button.getAttribute('aria-activedescendant'), null, 'no dangling active reference');
fallback.key('Enter');
assert.equal(fallback.select.selectedIndex, 1);
assert.deepEqual(fallback.changes, [], 'empty enabled list cannot commit a different option');
fallback.group.hidden = false; fallback.notify('hidden');
assert.equal(fallback.active().textContent, 'C', 'restored option becomes the valid highlight');

// Native visibility must control the wrapper and dismiss an already-open menu.
const visibility = fixture(true);
assert.equal(visibility.wrap.hidden, true, 'initially hidden native select has no visible trigger');
visibility.select.hidden = false; visibility.notify('hidden'); visibility.open();
assert.equal(visibility.menu.hidden, false);
visibility.select.hidden = true; visibility.notify('hidden');
assert.equal(visibility.wrap.hidden, true);
assert.equal(visibility.menu.hidden, true, 'hiding the native select closes its popup');
assert.equal(visibility.button.getAttribute('aria-expanded'), 'false');
assert.equal(visibility.button.getAttribute('aria-activedescendant'), null);
visibility.select.hidden = false; visibility.notify('hidden');
assert.equal(visibility.wrap.hidden, false, 'showing the native select restores its wrapper');
visibility.select.required = true; visibility.notify('required');
assert.equal(visibility.button.getAttribute('aria-required'), 'true');
visibility.select.required = false; visibility.notify('required');
assert.equal(visibility.button.getAttribute('aria-required'), null);

console.log('PASS: select identity after redraw, safe fallback, hidden groups, native change handlers, visibility/close, required state.');
