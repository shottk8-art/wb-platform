import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { articleKey, costCatalogue } from '../supabase/functions/wb-api/articles.ts';
const window={};
vm.runInNewContext(fs.readFileSync('assets/dashboard.js','utf8'),{window,Intl,Map,Set,WeakMap,Date});
const rows=[
 {article:'Top-114',cost_price:1160,updated_at:'2026-09-01T00:00:00Z'},
 {article:'top-114',cost_price:0,updated_at:'2026-10-01T00:00:00Z'},
 {article:' TOP-113 ',cost_price:120,updated_at:'2026-09-01T00:00:00Z'},
 {article:'top-113',cost_price:125,updated_at:'2026-10-01T00:00:00Z'},
 {article:'top-114-1',cost_price:300},
 {article:'БЕРБЕРИН',cost_price:380},
];
for(const fixture of [rows,[...rows].reverse()]) {
 const api=costCatalogue(fixture), browser=window.WBDashboard.costCatalogue(fixture);
 assert.equal(api.get('top-114').cost_price,1160);
 assert.equal(api.get('top-113').cost_price,125,'latest filled price wins consistently across aliases');
 assert.equal(api.get('top-114-1').cost_price,300,'suffixes must not be stripped');
 assert.equal(api.get('берберин').cost_price,380);
 assert.deepEqual([...api],[...browser],'API and file reports use the same resolution rules');
}
assert.equal(articleKey(' Top-114 '),'top-114');
assert.equal(costCatalogue([{article:'top-114',cost_price:0}]).get('top-114').cost_price,0,'unrelated shop prices are never added to the lookup');
console.log('Article resolver parity: PASS (case, whitespace, Cyrillic, zero placeholders, latest price, suffixes).');
