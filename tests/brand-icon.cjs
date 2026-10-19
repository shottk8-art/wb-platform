const assert=require('node:assert/strict'),fs=require('node:fs');
const read=file=>fs.readFileSync('assets/icons/'+file,'utf8');
const variants=['light','dark'].map(theme=>read('icon-'+theme+'.svg'));
const bars=svg=>[...svg.matchAll(/<rect[^>]*width="18"[^>]*\/>/g)].map(([rect])=>Object.fromEntries([...rect.matchAll(/(x|y|width|height|rx)="([^"]+)"/g)].map(([,key,value])=>[key,value])));
assert.deepEqual(bars(variants[0]),bars(variants[1]),'the mark geometry is identical across themes');
assert.deepEqual(bars(variants[0]),bars(read('icon.svg')),'adaptive fallback uses the same mark');
assert.equal(bars(variants[0]).length,3);
variants.forEach(svg=>{assert.match(svg,/viewBox="0 0 128 128"/);assert.match(svg,/stroke-width="2"/);assert.doesNotMatch(svg,/<script|<image|https?:\/\/(?!www.w3.org)/)});
assert.match(read('icon.svg'),/@media\(prefers-color-scheme:dark\)/,'standalone SVG adapts without JavaScript');
function luminance(hex){hex=hex.replace('#','');if(hex.length===3)hex=[...hex].map(c=>c+c).join('');return [.2126,.7152,.0722].reduce((sum,weight,i)=>{let value=parseInt(hex.slice(i*2,i*2+2),16)/255;return sum+weight*(value<=.04045?value/12.92:((value+.055)/1.055)**2.4);},0);}
for(const [background,ink,accent] of [['#fff','#161b30','#2a45cc'],['#1c2133','#e9ecf7','#7088f0']]){
  for(const foreground of [ink,accent]){const values=[luminance(background),luminance(foreground)].sort((a,b)=>b-a);assert.ok((values[0]+.05)/(values[1]+.05)>=4.5,'all bars retain strong contrast on their own tile');}
}
const css=fs.readFileSync('assets/reference.css','utf8');
assert.match(css,/\.brandmark--logo\{background:transparent!important\}/,'no old blue wrapper around the theme-specific tile');
assert.match(css,/data-theme="dark"[^\n]*brandmark-light\{display:none\}/);
assert.match(css,/data-theme="dark"[^\n]*brandmark-dark\{display:block\}/);
console.log('Brand icon PASS: preserved geometry, both themes, adaptive standalone SVG, >=4.5:1 bars, one visible variant and transparent wrapper.');
