import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const start=html.indexOf("    document.getElementById('overviewRefresh').addEventListener");
const end=html.indexOf('    window.WBApiCabinet.subscribe',start);
const button={disabled:false,textContent:'Обновить'}, select={value:'2026-10'}, calls=[];
let click,allowed=true,pending;
button.addEventListener=(_type,fn)=>click=fn;
const state={shop:{id:'green'},overviewScope:'wildberries',document:{getElementById:id=>id==='overviewRefresh'?button:select},
  usesApiData:()=>allowed,window:{WBApiCabinet:{currentMonth:'2026-10',refreshOverview:async key=>{calls.push(key);if(pending)return new Promise(resolve=>pending.resolve=resolve);return {job:{status:'loading'}};}}},
  refreshPeriods:async(year,month)=>calls.push([year,month]),renderCurrentPeriod:async()=>{},toast:()=>{}};
vm.runInNewContext(html.slice(start,end),state);
await click();assert.equal(calls[0],'2026-10');assert.equal(calls.length,2);assert.equal(button.disabled,true);
await click();assert.equal(calls.length,2,'repeated click cannot enqueue a second refresh');
allowed=false;button.disabled=false;await click();assert.equal(calls.length,2,'non API/other shop cannot refresh private data');
allowed=true;pending={};button.disabled=false;
const updating=click();select.value='2026-9';button.textContent='Обновить';button.disabled=false;
pending.resolve({job:{status:'loading'}});await updating;
assert.equal(calls.length,3,'slow refresh cannot jump back to a month the user already left');
assert.equal(button.disabled,false);
console.log('Overview refresh: passed (selected month, queued-only request, repeated-click guard, private gate, stale selection).');
