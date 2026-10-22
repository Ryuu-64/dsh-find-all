import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryRevisionTracker } from '../src/history-revision.js';

const store = nodes => ({ nodes, values() { return this.nodes; } });
const snapshot = throughSeq => ({ sessionId: 'session-a', generation: 1, documents: [], throughSeq, readComplete: true, projectionComplete: true, revision: 4 });
const user = (key = 'user-7', seq = 7, extra = {}) => ({ key, kind: 'user', data: { seq, messageId: key, content: [{ type: 'text', text: 'hello' }], ...extra } });
const assistant = (extra = {}) => ({ key: 'step-1:1', kind: 'assistant-step', data: {
  status: 'settled', turn: 1, step: 1, time: 20,
  finalNode: { seq: 10, messageId: 'assistant-10', content: [{ type: 'text', text: 'answer' }] },
  blocks: [{ kind: 'text', text: 'answer' }], ...extra,
} });

test('constructor captures before the history await, so first check detects during-read facts changes', async () => {
  const chat = store([user()]);
  const tracker = createHistoryRevisionTracker(chat);
  await Promise.resolve();
  chat.nodes = [user(undefined, undefined, { referenceLabels: ['confirmed label'], skillNames: ['demo'] })];
  assert.equal(tracker.check(chat, snapshot(12)), true);
});

test('real reader throughSeq, not remote cursor, bounds newly appended durable nodes', () => {
  const chat = store([user()]);
  const tracker = createHistoryRevisionTracker(chat);
  assert.equal(tracker.check(chat, snapshot(7)), false);
  chat.nodes.push(user('new-user', 8));
  assert.equal(tracker.check(chat, { ...snapshot(7), cursor: 999 }), true);
});

test('new durable Assistant settlement beyond the read cut invalidates', () => {
  const running = assistant({ status: 'running', finalNode: undefined, blocks: [{ kind: 'text', text: 'partial' }] });
  const chat = store([running]); const tracker = createHistoryRevisionTracker(chat);
  assert.equal(tracker.check(chat, snapshot(9)), false);
  chat.nodes = [assistant()];
  assert.equal(tracker.check(chat, snapshot(9)), true);
});

test('running Assistant updates have no durable final node and never invalidate or serialize', () => {
  let serializations = 0;
  const chat = store([assistant({ status: 'running', finalNode: undefined, seq: 999, toJSON() { serializations++; throw Error('must not serialize'); } })]);
  const tracker = createHistoryRevisionTracker(chat);
  for (const status of ['running', 'interrupted']) {
    chat.nodes = [assistant({ status, finalNode: undefined, blocks: [{ kind: 'text', text: 'more live content' }], seq: 1000, toJSON() { serializations++; throw Error('must not serialize'); } })];
    assert.equal(tracker.check(chat, snapshot(7)), false);
  }
  assert.equal(serializations, 0);
});

test('settled Assistant comparison excludes transient wrapper status, usage and time', () => {
  const original = assistant(); const chat = store([original]);
  const tracker = createHistoryRevisionTracker(chat);
  chat.nodes = [{ ...original, data: { ...original.data, status: 'interrupted', time: 999, usage: { outputTokens: 8 }, unrelatedChrome: true } }];
  assert.equal(tracker.check(chat, snapshot(12)), false);
  chat.nodes = [{ ...chat.nodes[0], data: { ...chat.nodes[0].data, blocks: [{ kind: 'text', text: 'changed final body' }] } }];
  assert.equal(tracker.check(chat, snapshot(12)), true);
});

test('settled Assistant durable final-node changes invalidate independently of blocks', () => {
  const original = assistant(); const chat = store([original]);
  const tracker = createHistoryRevisionTracker(chat);
  chat.nodes = [{ ...original, data: { ...original.data, finalNode: { ...original.data.finalNode, messageId: 'replacement' } } }];
  assert.equal(tracker.check(chat, snapshot(12)), true);
});

test('loading earlier pages creates baselines without invalidation, then detects later old-node edits', () => {
  const chat = store([user()]); const tracker = createHistoryRevisionTracker(chat);
  chat.nodes.unshift(user('older', 1));
  assert.equal(tracker.check(chat, snapshot(12)), false);
  assert.equal(tracker.check(chat, snapshot(12)), false);
  chat.nodes[0] = user('older', 1, { referenceLabels: ['later recall'] });
  assert.equal(tracker.check(chat, snapshot(12)), true);
});

test('dropping loaded nodes and later restoring them does not erase the initial baseline', () => {
  const initial = user(); const chat = store([initial]);
  const tracker = createHistoryRevisionTracker(chat);
  chat.nodes = [];
  assert.equal(tracker.check(chat, snapshot(12)), false);
  chat.nodes = [structuredClone(initial)];
  assert.equal(tracker.check(chat, snapshot(12)), false);
  chat.nodes = [user(undefined, undefined, { skillNames: ['changed while unloaded'] })];
  assert.equal(tracker.check(chat, snapshot(12)), true);
});

test('same-session new store generation invalidates even with identical node values', () => {
  const original = user(); const chat = store([original]);
  const tracker = createHistoryRevisionTracker(chat);
  assert.equal(tracker.check(store([original]), snapshot(12)), true);
});

test('all official input message kinds retain content, labels, skills and source facts in comparison', () => {
  for (const kind of ['user', 'steering', 'context', 'turn-trigger']) {
    const original = { ...user(), kind };
    const chat = store([original]); const tracker = createHistoryRevisionTracker(chat);
    chat.nodes = [{ ...original, data: { ...original.data, source: { kind: 'session-reference', references: [{ label: 'confirmed' }] } } }];
    assert.equal(tracker.check(chat, snapshot(12)), true);
  }
});

test('unknown/UI-only nodes and invalid durable sequence fields are excluded', () => {
  const chat = store([
    { key: 'tail', kind: 'turn-tail', data: { seq: 999 } },
    { key: 'tool', kind: 'tool-call', data: { seq: 999, root: { kind: 'running' } } },
    user('negative', -1), user('fraction', 1.5), user('negative-zero', -0), user('string', '9'),
  ]);
  const tracker = createHistoryRevisionTracker(chat);
  chat.nodes[0] = { ...chat.nodes[0], data: { seq: 1000 } };
  assert.equal(tracker.check(chat, snapshot(0)), false);
});

test('signatures are serialized only when a known node data reference changes', () => {
  let calls = 0;
  const data = { seq: 7, toJSON() { calls++; return { seq: 7, text: 'PRIVATE_SYNTHETIC_TEXT' }; } };
  const chat = store([{ key: 'user-7', kind: 'user', data }]);
  const tracker = createHistoryRevisionTracker(chat);
  assert.equal(calls, 1);
  for (let i = 0; i < 3; i++) assert.equal(tracker.check(chat, snapshot(7)), false);
  assert.equal(calls, 1);
  chat.nodes = [{ key: 'user-7', kind: 'user', data: { ...data } }];
  assert.equal(tracker.check(chat, snapshot(7)), false);
  assert.equal(calls, 2);
  assert.deepEqual(Object.keys(tracker), ['check']);
  assert.equal(JSON.stringify(tracker), '{}');
});

test('cut may be pending during the read, but its arrival still detects newer durable nodes', () => {
  const chat = store([user()]); const tracker = createHistoryRevisionTracker(chat);
  chat.nodes.push(user('new', 9));
  assert.equal(tracker.check(chat, { throughSeq: null, readComplete: false }), false);
  assert.equal(tracker.check(chat, snapshot(7)), true);
});

test('empty history cut -1 detects its first durable node and changed remains sticky', () => {
  const chat = store([]); const tracker = createHistoryRevisionTracker(chat);
  assert.equal(tracker.check(chat, snapshot(-1)), false);
  chat.nodes.push(user('first', 0));
  assert.equal(tracker.check(chat, snapshot(-1)), true);
  chat.nodes = [];
  assert.equal(tracker.check(chat, snapshot(0)), true);
});

test('unavailable stores and unserializable durable data fail closed without exposing private errors', () => {
  assert.equal(createHistoryRevisionTracker(undefined).check(undefined, snapshot(0)), true);
  const circular = { seq: 1 }; circular.self = circular;
  const chat = store([{ key: 'bad', kind: 'user', data: circular }]);
  let tracker;
  assert.doesNotThrow(() => { tracker = createHistoryRevisionTracker(chat); });
  assert.equal(tracker.check(chat, snapshot(1)), true);
});
