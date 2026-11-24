const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const legacy=text=>{let out='',i=0;while(i<text.length){const c=text.charCodeAt(i++);if(c<128){out+=String.fromCharCode(c);continue;}const d=text.charCodeAt(i++);if(c>191&&c<224){out+=String.fromCharCode(((c&31)<<6)|(d&63));continue;}const e=text.charCodeAt(i++);if(c<240){out+=String.fromCharCode(((c&15)<<12)|((d&63)<<6)|(e&63));continue;}const f=text.charCodeAt(i++),w=(((c&7)<<18)|((d&63)<<12)|((e&63)<<6)|(f&63))-65536;out+=String.fromCharCode(0xD800+((w>>>10)&1023),0xDC00+(w&1023));}return out;};
const encode=({r,c})=>{let name='';for(c++;c;c=Math.floor((c-1)/26))name=String.fromCharCode(65+(c-1)%26)+name;return name+(r+1);};
const decode=a=>({r:Number(a.match(/\d+/)[0])-1,c:[...a.match(/[A-Z]+/)[0]].reduce((n,x)=>n*26+x.charCodeAt(0)-64,0)-1});
const xmlText=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\u0080-\uffff]/g,c=>'&#x'+c.charCodeAt(0).toString(16)+';');
const header=['Дата начисления','Группа услуг','Тип начисления','Артикул','SKU','Название товара','Количество','Цена продавца','Сумма итого, руб.'];
const rows=[['01.10.2026 — 31.10.2026'],header,['10.10.2026','Продажи','Выручка','топ/Coinбелый','','Топ & брюки <стрейч>',2,2000,4000],['11.10.2026','Вознаграждение Ozon','','топ/Coinбелый','','Топ & брюки <стрейч>',0,0,-500],['12.10.2026','Продажи','Выручка','sku-中国','','Товар 🧥',1,1000,1000]];
function fixture({sparse=false,refs=true,missing=false}={}){
 const sheet={},rawRows=rows.map((row,r)=>{const cells=row.map((v,c)=>{if(sparse&&r===2&&c===4)return `<c${refs?' r="E3"':''}/>`;const address=encode({r,c});sheet[address]={v:typeof v==='string'?legacy(v):v,t:typeof v==='string'?'s':'n'};return `<c${refs?' r="'+address+'"':''} t="${typeof v==='string'?'str':'n'}"><v>${typeof v==='string'?xmlText(v):v}</v></c>`;}).join('');return `<row${refs?' r="'+(r+1)+'"':''}>${cells}</row>`;});
 const workbook={SheetNames:['Обложка','Начисления'],Sheets:{Обложка:{},Начисления:sheet}};
 const files={'xl/workbook.xml':new TextEncoder().encode('<workbook><sheets><sheet name="Обложка" r:id="first"/><sheet name="Начисления" r:id="data"/></sheets></workbook>'),'xl/_rels/workbook.xml.rels':new TextEncoder().encode('<Relationships><Relationship Id="first" Target="worksheets/sheet1.xml"/><Relationship Id="data" Target="/xl/worksheets/actual.xml"/></Relationships>'),'xl/worksheets/sheet1.xml':new TextEncoder().encode('<worksheet><row><c t="str"><v>WRONG SHEET</v></c></row></worksheet>'),'xl/worksheets/actual.xml':new TextEncoder().encode('<worksheet>'+rawRows.join('')+'</worksheet>')};
 if(missing)delete files['xl/worksheets/actual.xml'];
 const app={XLSX:{read:()=>workbook,utils:{encode_cell:encode,decode_cell:decode,sheet_to_json:s=>rows.map((row,r)=>row.map((_,c)=>s[encode({r,c})]?.v??null))}},fflate:{unzipSync(_bytes,options){assert(!options.filter({name:'xl/styles.xml'}),'only relevant XML is decompressed');return files;}}};
 const ctx={window:app,document:{},Map,Set,Date,TextDecoder,Uint8Array,BigInt,Number};vm.createContext(ctx);
 vm.runInContext(fs.readFileSync('assets/ozon-model.js','utf8'),ctx);vm.runInContext(fs.readFileSync(process.env.WB_PARSE_SOURCE||'assets/parse.js','utf8'),ctx);
 return app;
}
(async()=>{
 for(const options of [{},{sparse:true},{refs:false,sparse:true}]){
  const app=fixture(options),result=await app.WBParse.parseOzonAccruals({arrayBuffer:async()=>new ArrayBuffer(1)}),p=result.periods[0];
  assert.equal(p.skus[0].article,'топ/Coinбелый','article must be recovered before grouping');assert.equal(p.skus[0].name,'Топ & брюки <стрейч>');assert.equal(p.skus[1].article,'sku-中国');assert.equal(p.skus[1].name,'Товар 🧥','valid Unicode is not discarded');
  assert.equal(result.transactionCount,3);assert.equal(p.report.sales_amount,5000);assert.equal(p.report.transfer_total,4500);assert.equal(p.report.bought_qty,3);assert.equal(p.analytics.products.find(x=>x.article==='топ/Coinбелый').net,'3500.00');assert.equal(p.analytics.days['2026-10-11'].products[0].article,'топ/Coinбелый');
 }
 await assert.rejects(()=>fixture({missing:true}).WBParse.parseOzonAccruals({arrayBuffer:async()=>new ArrayBuffer(1)}),/Не удалось прочитать текст листа Ozon/,'failure must stop an import, never store corrupted IDs');
 console.log('Ozon text PASS: original Cyrillic/Chinese/emoji, exact selected worksheet, sparse/self-closing/addressed cells, monthly and daily identities, unchanged money and fail-closed reads');
})().catch(error=>{console.error(error);process.exitCode=1;});
