import test from 'node:test';
import assert from 'node:assert/strict';
import {setup, snapshot, key} from './helpers/search-ui.mjs';

const available = 'Searched currently available history; the host offers no earlier pages, so completeness cannot be confirmed';
const incomplete = /History search incomplete/;

for (const terminal of ['initial', 'empty', 'content', 'discontinuous-public-state']) {
  test(`history termination reports available range: ${terminal}`, async () => {
    const h = setup();
    try {
      const v = await h.mount('a'); let calls = 0;
      const state = snapshot({hasMore: terminal !== 'initial'});
      h.faces.set('a', { getSnapshot: () => state, async loadOlder() {
        calls++;
        if (terminal === 'content') v.flow.insertAdjacentHTML('afterbegin', '<p>earlier needle</p>');
        // Both outcomes are identical through SessionFace: the official
        // discontinuity is swallowed by loadOlder after publishing false.
        state.hasMore = false;
      } });
      h.open(v.anchor); h.search('needle'); await h.advance(600);
      assert.equal(h.status(), available);
      assert.equal(calls, terminal === 'initial' ? 0 : 1);
      assert.equal(h.count(), terminal === 'content' ? '2/2' : '1/1');
      assert.equal(h.w.document.querySelector('.status').hasAttribute('data-busy'), false);
      key(h, 'Enter'); assert.ok(h.count().startsWith('1/'));
    } finally { await h.finish(); }
  });
}

test('valid active empty content retains 0/0 and neutral termination', async () => {
  const h = setup();
  try {
    const v = await h.mount('a'); v.flow.replaceChildren();
    h.faces.set('a', {getSnapshot: () => snapshot({hasMore: false, blank: true}), loadOlder() {assert.fail('no page');}});
    h.open(v.anchor); h.search('needle'); await h.advance(600);
    assert.equal(h.count(), '0/0'); assert.equal(h.status(), available);
  } finally { await h.finish(); }
});

for (const patch of [
  {openState: 'cold'}, {openState: 'loading'}, {openState: 'error'},
  {openError: {message: 'failed'}}, {loadingOlder: true},
  {openState: undefined}, {openError: undefined}, {loadingOlder: undefined},
]) {
  test(`false cannot override unready/error/unknown public state ${JSON.stringify(patch)}`, async () => {
    const h = setup();
    try {
      const v = await h.mount('a'); let calls = 0;
      h.faces.set('a', {getSnapshot: () => snapshot({hasMore: false, ...patch}), loadOlder() {calls++;}});
      h.open(v.anchor); h.search('needle'); await h.advance(5500);
      assert.equal(calls, 0); assert.equal(h.count(), '1/1'); assert.match(h.status(), incomplete);
    } finally { await h.finish(); }
  });
}

for (const patch of [{openState: 'cold'}, {openState: 'loading'}, {loadingOlder: true}]) {
  test(`waits for ready public state before observing false: ${JSON.stringify(patch)}`, async () => {
    const h = setup();
    try {
      const v = await h.mount('a'); const state = snapshot({hasMore: false, ...patch}); let calls = 0;
      h.faces.set('a', {getSnapshot: () => state, loadOlder() {calls++;}});
      h.open(v.anchor); h.search('needle'); await h.advance(600);
      assert.match(h.status(), /Loading earlier history… 0 pages/); assert.equal(calls, 0);
      Object.assign(state, snapshot({hasMore: false})); await h.advance(300);
      assert.equal(calls, 0); assert.equal(h.status(), available);
    } finally { await h.finish(); }
  });
}

test('external busy host waits, does not invoke the host no-op or inflate page count', async () => {
  const h = setup();
  try {
    const v = await h.mount('a'); const state = snapshot({loadingOlder: true}); let calls = 0;
    h.faces.set('a', {getSnapshot: () => state, async loadOlder() {calls++; state.hasMore = false;}});
    h.open(v.anchor); h.search('needle'); await h.advance(600);
    assert.equal(calls, 0); assert.match(h.status(), /0 pages/);
    state.loadingOlder = false; await h.advance(300);
    assert.equal(calls, 1); assert.equal(h.status(), available);
  } finally { await h.finish(); }
});

test('stop and retry waits for its still-pending same-face request, then uses its terminal snapshot', async () => {
  const h = setup();
  try {
    const v = await h.mount('a'); let finish, calls = 0; const state = snapshot();
    h.faces.set('a', {getSnapshot: () => state, loadOlder() {calls++; return new Promise(resolve => finish = resolve);}});
    h.open(v.anchor); h.search('needle'); await h.advance(300);
    h.w.document.querySelector('.status').click(); assert.match(h.status(), incomplete);
    h.search('needle'); await h.advance(800);
    assert.equal(calls, 1); assert.match(h.status(), /0 pages/);
    state.hasMore = false; finish(); await h.advance(300);
    assert.equal(calls, 1); assert.equal(h.status(), available);
  } finally { await h.finish(); }
});

test('ordinary failure can be manually retried without an automatic retry loop', async () => {
  const h = setup();
  try {
    const v = await h.mount('a'); let calls = 0; const state = snapshot();
    h.faces.set('a', {getSnapshot: () => state, async loadOlder() {
      if (++calls === 1) throw Error('temporary'); state.hasMore = false;
    }});
    h.open(v.anchor); h.search('needle'); await h.advance(600);
    assert.equal(calls, 1); assert.match(h.status(), incomplete);
    await h.advance(7000); assert.equal(calls, 1);
    h.search('needle'); await h.advance(600);
    assert.equal(calls, 2); assert.equal(h.status(), available);
  } finally { await h.finish(); }
});

test('unknown hasMore with no progress remains incomplete', async () => {
  const h = setup();
  try {
    const v = await h.mount('a'); let calls = 0;
    h.faces.set('a', {getSnapshot: () => snapshot({hasMore: undefined}), async loadOlder() {calls++;}});
    h.open(v.anchor); h.search('needle'); await h.advance(6000);
    assert.equal(calls, 1); assert.equal(h.count(), '1/1'); assert.match(h.status(), incomplete);
  } finally { await h.finish(); }
});

test('public failure arriving during DOM settlement overrides false and keeps navigation', async () => {
  const h = setup();
  try {
    const v = await h.mount('a'); const state = snapshot();
    h.faces.set('a', {getSnapshot: () => state, async loadOlder() {}});
    h.open(v.anchor); h.search('needle'); await h.advance(300);
    state.hasMore = false; state.openError = {message: 'rebuild failed'}; await h.advance(300);
    assert.match(h.status(), incomplete); assert.equal(h.count(), '1/1');
    key(h, 'Enter'); assert.equal(h.count(), '1/1');
  } finally { await h.finish(); }
});

test('late requests cannot paint after query change, close, or face replacement', async () => {
  for (const action of ['query', 'close', 'face']) {
    const h = setup();
    try {
      const v = await h.mount('a'); let finish; const state = snapshot();
      h.faces.set('a', {getSnapshot: () => state, loadOlder() {return new Promise(resolve => finish = resolve);}});
      h.open(v.anchor); h.search('needle'); await h.advance(300);
      if (action === 'query') h.search('absent');
      if (action === 'close') key(h, 'Escape');
      if (action === 'face') h.faces.set('a', {getSnapshot: () => snapshot({hasMore: false}), loadOlder() {assert.fail('no new task');}});
      state.hasMore = false; finish(); await h.advance(600);
      if (action === 'close') {assert.equal(h.w.CSS.highlights.size, 0); assert.equal(h.timers.size, 0);}
      if (action === 'query') {assert.equal(h.count(), '0/0'); assert.equal(h.w.CSS.highlights.size, 0);}
      if (action === 'face') assert.match(h.status(), incomplete);
    } finally { await h.finish(); }
  }
});

test('a hanging request times out logically without allowing a duplicate on manual retry', async () => {
  const h = setup();
  try {
    const v = await h.mount('a'); let calls = 0, finish;
    h.faces.set('a', {getSnapshot: () => snapshot(), loadOlder() {calls++; return new Promise(resolve => finish = resolve);}});
    h.open(v.anchor); h.search('needle'); await h.advance(5600);
    assert.equal(calls, 1); assert.match(h.status(), incomplete);
    h.search('needle'); await h.advance(5600);
    assert.equal(calls, 1); assert.match(h.status(), incomplete);
    key(h, 'Escape'); finish(); await h.advance(600);
    assert.equal(h.timers.size, 0); assert.equal(h.w.CSS.highlights.size, 0);
  } finally { await h.finish(); }
});
