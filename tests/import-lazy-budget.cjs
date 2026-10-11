const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
let scripts=[],reads=0;
const window={};
const document={createElement:()=>({remove(){}}),head:{append(script){scripts.push(script);setImmediate(()=>{
 window.XLSX={read(){reads++;return {SheetNames:['sheet'],Sheets:{sheet:{}}};},utils:{sheet_to_json:()=>[['Артикул','Себестоимость'],['sku',380]]}};
 script.onload();
})}}};
vm.runInNewContext(fs.readFileSync('assets/parse.js','utf8'),{window,document,Map,Set,Date});
assert.equal(scripts.length,0,'opening the overview must not download import libraries');
const file={arrayBuffer:async()=>new ArrayBuffer(0)};
(async()=>{
 const results=await Promise.all([window.WBParse.parseCostsFile(file),window.WBParse.parseCostsFile(file)]);
 assert.equal(scripts.length,1,'simultaneous imports share one dependency download');
 assert.equal(reads,2);
 assert.equal(results[0][0].cost_price,380);
 console.log('Import lazy budget: PASS (zero library downloads on dashboard, one shared first-import download).');
})().catch(e=>{console.error(e);process.exitCode=1;});
