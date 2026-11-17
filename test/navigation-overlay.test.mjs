import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
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
test('modern exhausted history is ready for navigation while a pending render is not', () => {
  const start = code.indexOf('function hostNavigationReady(');
  const end = code.indexOf('// Exact navigation', start);
  const ready = vm.runInNewContext(`${code.slice(start, end)};hostNavigationReady`, {
    facePageState: () => ({ hasMore: false }),
    pendingLoads: new WeakMap(),
  });
  const dom = new JSDOM('<main><div data-chat-history="idle"><button disabled>Start of conversation</button></div></main>');
  try {
    const root = dom.window.document.querySelector('main');
    assert.equal(ready({ root }, {}), true);
    const control = root.querySelector('[data-chat-history]');
    control.setAttribute('data-chat-history', 'loading');
    control.querySelector('button').disabled = false;
    assert.equal(ready({ root }, {}), false);
    control.removeAttribute('data-chat-history');
    control.querySelector('button').disabled = true;
    assert.equal(ready({ root }, {}), false, 'legacy disabled control still blocks navigation');
  } finally {
    dom.window.close();
  }
});

function historyJumpFixture(loadThrough, initiallyBusy = true) {
  const hit = { source: { seq: 3 }, blockIndex: 0, start: 0, end: 6, text: 'needle' };
  const earlier = { ...hit, source: { seq: 1 }, text: 'before' };
  const store = {}, target = {};
  const requests = [], selected = [], failures = [];
  let busy = initiallyBusy, loadedThrough = Infinity, elapsed = 0, settle;
  const host = {
    setBusy(value) { busy = value; },
    mountThrough(seq) { loadedThrough = seq; },
  };
  const face = {
    async loadThrough(seq) {
      requests.push(seq);
      if (loadThrough) return loadThrough(seq, host);
      if (!busy) host.mountThrough(seq);
    },
  };
  const state = {
    navigationToken: 0, queryToken: 0, target, scope: 'whole', hits: [hit, earlier], index: 0, ranges: [],
    adapter: { face: () => face, nodes: () => store, valid: () => true },
  };
  const start = code.indexOf('async function navigateHistoryHit(');
  const end = code.indexOf('function syncTarget(', start);
  const jump = vm.runInNewContext(`${code.slice(start, end)};navigateHistoryHit`, {
    state, PAGE_SETTLE_MS: 5000, pendingLoads: new WeakMap(), Date: { now: () => elapsed },
    setTimeout: callback => { settle = callback; },
    facePageState: () => busy ? null : { hasMore: true },
    sourceNode: source => source.seq >= loadedThrough ? source : null,
    sourceRows: () => [],
    hostNavigationReady: () => true,
    mapProjectedDocument: source => ({ blocks: [state.hits.find(hit => hit.source === source)] }),
    rangeForBlock: hit => ({ toString: () => hit.text }),
    isOpen: () => true,
    paint() {},
    historyStatus() {},
    recordFailure: (_kind, failure) => failures.push(failure),
    L: { matchRevealFailed: 'Unavailable' },
    navigateToRange: match => selected.push(match.toString()),
  });
  return {
    start: () => jump(hit),
    selectEarlier() { state.index = 1; return jump(earlier); },
    finishHostRead: () => { busy = false; },
    advance(ms) { elapsed += ms; settle?.(); },
    requests, selected, failures, state,
  };
}

test('an offscreen match retries once after an ordinary Host page has finished', async () => {
  const h = historyJumpFixture();
  const navigation = h.start();
  await setImmediate();
  assert.deepEqual(h.requests, [3]);
  h.finishHostRead();
  h.advance(35);
  await navigation;
  assert.deepEqual(h.requests, [3, 3]);
  assert.deepEqual(h.selected, ['needle']);
});

test('a busy no-op can settle in the same turn as the ordinary Host page', async () => {
  let first = true;
  const h = historyJumpFixture((seq, host) => {
    if (first) { first = false; host.setBusy(false); }
    else host.mountThrough(seq);
  });
  const navigation = h.start();
  assert.deepEqual(h.requests, [3]);
  await navigation;
  assert.deepEqual(h.requests, [3, 3]);
  assert.deepEqual(h.selected, ['needle']);
});

test('an earlier match retargets an active Host jump before the wait deadline', async () => {
  let finishJump, jumpTarget = Infinity, activeJump;
  const h = historyJumpFixture((seq, host) => {
    jumpTarget = Math.min(jumpTarget, seq);
    if (!activeJump) {
      host.setBusy(true);
      activeJump = new Promise(resolve => {
        finishJump = () => { host.mountThrough(jumpTarget); host.setBusy(false); resolve(); };
      });
    }
    return activeJump;
  }, false);
  const first = h.start();
  const earlier = h.selectEarlier();
  h.advance(5100);
  assert.deepEqual(h.requests, [3, 1]);
  finishJump();
  await Promise.all([first, earlier]);
  assert.deepEqual(h.selected, ['before']);
  assert.deepEqual(h.failures, []);
});

test('waiting for the Host never issues a jump after cancellation or timeout', async () => {
  for (const replace of [state => state.queryToken++, state => { state.target = {}; }]) {
    const replaced = historyJumpFixture();
    const cancelled = replaced.start();
    await setImmediate();
    replace(replaced.state);
    replaced.finishHostRead();
    replaced.advance(35);
    await cancelled;
    assert.deepEqual(replaced.requests, [3]);
  }

  const stalled = historyJumpFixture();
  const timedOut = stalled.start();
  await setImmediate();
  stalled.advance(5000);
  await timedOut;
  assert.deepEqual(stalled.requests, [3]);
  assert.deepEqual(stalled.failures, ['render']);
});

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
