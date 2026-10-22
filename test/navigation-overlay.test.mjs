import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const code=readFileSync(new URL('../src/client.js',import.meta.url),'utf8');
const start=code.indexOf('function matchLineMargin('),end=code.indexOf('function scrollToRange(',start);
assert.ok(start>=0&&end>start,'navigation helpers must remain available to the focused test');
function helpers(lineHeight='22px',bar=null){
 return vm.runInNewContext(`${code.slice(start,end)};({matchLineMargin,matchScrollPlan,matchLanding})`,{
  window:{getComputedStyle:()=>({lineHeight})},matchAnchorRect:r=>r.rect,
  clippedViewport:(_element,viewport)=>viewport,matchBarRect:()=>bar,
 });
}
function rangeAt(top,height=16){
 return {rect:{top,bottom:top+height,left:120,right:153,width:33,height},startContainer:{parentElement:{}}};
}
const api=helpers();
test('bar avoidance uses the same line margin as stable navigation, avoiding a false reversal',()=>{
 const range={rect:{top:159,bottom:175,left:930,right:963,width:33,height:16},startContainer:{parentElement:{}}};
 const viewport={top:108,bottom:629,left:280,right:1178},scroll={scrollTop:0,scrollHeight:2167,clientHeight:649};
 const oldBar={top:183,bottom:269,left:690,right:1170};
 const before=api.matchScrollPlan(range,scroll,viewport,oldBar,true);
 assert.equal(before.comfortable,false);assert.equal(before.delta,25.5);
 const top=range.rect.bottom+8+api.matchLineMargin(range,range.rect);
 const after=api.matchScrollPlan(range,scroll,viewport,{...oldBar,top,bottom:top+86},true);
 assert.equal(after.comfortable,true);assert.equal(after.delta,0);
});

test('normal, non-pixel, zero and negative line heights fall back to the painted fragment height',()=>{
 const range=rangeAt(159,16);
 for(const lineHeight of ['normal','1.5','150%','1.5em','calc(1em + 2px)','','0px','0.0px','-12px','-0.5px','Infinitypx']){
  const actual=helpers(lineHeight).matchLineMargin(range,range.rect);
  assert.equal(actual,16,`line-height ${JSON.stringify(lineHeight)} must use the Range fragment`);
 }
 assert.equal(helpers('18.5px').matchLineMargin(range,range.rect),18.5);
 assert.equal(helpers('0.5px').matchLineMargin(range,range.rect),0.5);
});

test('centering clamps at the top and bottom of the scrollable history',()=>{
 const viewport={top:100,bottom:500,left:100,right:500};
 const topScroll={scrollTop:4,scrollHeight:800,clientHeight:200};
 const top=api.matchScrollPlan(rangeAt(106),topScroll,viewport,null,true);
 assert.equal(top.delta,-4);assert.equal(top.shown,16);assert.equal(top.comfortable,false);
 assert.equal(topScroll.scrollTop+top.delta,0);
 const bottomScroll={scrollTop:597,scrollHeight:800,clientHeight:200};
 const bottom=api.matchScrollPlan(rangeAt(478),bottomScroll,viewport,null,true);
 assert.equal(bottom.delta,3);assert.equal(bottom.shown,16);assert.equal(bottom.comfortable,false);
 assert.equal(bottomScroll.scrollTop+bottom.delta,600);
});

test('a clamped zero delta settles only a readable boundary hit, not an offscreen fragment',()=>{
 const viewport={top:100,bottom:500,left:100,right:500};
 for(const [scrollTop,visibleTop,clippedTop] of [[0,106,82],[600,478,502]]){
  const view={...viewport,scroll:{scrollTop,scrollHeight:800,clientHeight:200}};
  const readable=api.matchLanding(rangeAt(visibleTop),view);
  assert.equal(readable.plan.delta,0);assert.equal(readable.plan.comfortable,false);
  assert.equal(readable.readable,true);assert.equal(readable.settled,true);
  const clipped=api.matchLanding(rangeAt(clippedTop),view);
  assert.equal(clipped.plan.delta,0);assert.equal(clipped.plan.shown,0);
  assert.equal(clipped.readable,false);assert.equal(clipped.settled,false);
 }
});

test('a viewport shorter than the painted line never settles merely because its centered delta is zero',()=>{
 const viewport={top:100,bottom:112,left:100,right:500,scroll:{scrollTop:100,scrollHeight:800,clientHeight:200}};
 const landing=api.matchLanding(rangeAt(98),viewport);
 assert.equal(landing.plan.delta,0);assert.equal(landing.plan.shown,12);
 assert.equal(landing.plan.comfortable,false);assert.equal(landing.readable,false);
 assert.equal(landing.settled,false);
});

test('an overlay that consumes every available vertical band cannot produce a settled landing',()=>{
 const bar={top:100,bottom:130,left:100,right:500};
 const viewport={top:100,bottom:130,left:100,right:500,scroll:{scrollTop:100,scrollHeight:800,clientHeight:200}};
 const landing=helpers('normal',bar).matchLanding(rangeAt(108),viewport);
 assert.equal(landing.plan,null);assert.equal(landing.readable,false);
 assert.equal(landing.settled,false);
});
