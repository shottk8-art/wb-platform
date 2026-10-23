const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('assets/corbel-components.js', 'utf8');
const body = source.slice(source.indexOf('  function wireProfitabilityHelp('), source.indexOf('  function layout()'));
assert.ok(body.includes('function wireProfitabilityHelp'), 'exercise the actual tooltip controller');
const node = () => ({ events: {}, attrs: {}, hidden: true, style: {}, offsetWidth: 320, offsetHeight: 160,
  addEventListener(name, fn) { this.events[name] = fn; }, contains(target) { return target === this; },
  setAttribute(name, value) { this.attrs[name] = value; },
  getBoundingClientRect() { return { left: 360, bottom: 730 }; } });
const button = node(), popover = node(), window = { ...node(), innerWidth: 390, innerHeight: 844 };
const document = { ...node(), activeElement: null, body: { append(child) { this.child = child; } } };
let timer;
vm.runInNewContext(`${body}\nwireProfitabilityHelp(button,popover);`, { window, document, button, popover,
  clearTimeout() { timer = null; }, setTimeout(fn) { timer = fn; return 1; } });
const shown = expected => { assert.equal(popover.hidden, !expected); assert.equal(button.attrs['aria-expanded'], String(expected)); };
assert.equal(document.body.child, popover, 'popover escapes clipped/animated card');
button.events.pointerenter({ pointerType: 'mouse' }); shown(true);
assert.equal(popover.style.left, '54px'); assert.equal(popover.style.top, '668px');
button.events.pointerleave(); assert.ok(timer); popover.events.pointerenter(); shown(true); assert.equal(timer, null, 'tooltip remains hoverable');
popover.events.pointerleave(); timer(); shown(false);
document.activeElement = button; button.events.focus(); shown(true);
document.events.keydown({ key: 'Escape' }); shown(false);
document.activeElement = null; button.events.pointerenter({ pointerType: 'touch' }); shown(false);
button.events.click(); shown(true); button.events.pointerleave(); shown(true);
button.events.click(); shown(false);
button.events.click(); document.events.pointerdown({ target: button }); shown(true);
document.events.pointerdown({ target: {} }); shown(false);
button.events.focus(); button.events.blur(); shown(false);
button.events.click(); window.events.scroll(); shown(false);
button.events.click(); window.events.resize(); shown(false);
button.events.click(); window.events['seller:themechange'](); shown(false);
console.log('Profitability help: PASS (hover highlight state, keyboard/Escape, touch, outside dismiss, portal and phone bounds).');
