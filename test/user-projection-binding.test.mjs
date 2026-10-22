import test from 'node:test';
import assert from 'node:assert/strict';
import { createUserProjectionBinding } from '../src/user-projection-binding.js';

const NODE_SLOT = 'conversation.user.text.node';
const source = (raw = 'hello', sessionId = 'a') => ({ kind: 'user', sourceKind: 'user', raw, sessionId });
const text = value => [{ id: 'text', start: 0, end: value.length, data: { text: value } }];
const values = projection => projection.blocks.map(block => block.text);
function registry() {
  const listeners = new Set();
  return {
    listeners, creates: 0, evaluate: input => text(input.text),
    createEvaluator() { this.creates += 1; return input => this.evaluate(input); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    change(evaluate) { if (evaluate) this.evaluate = evaluate; for (const listener of [...listeners]) listener(); },
  };
}
function scope(userText) {
  const effects = new Set();
  return {
    userText, effects,
    get(name) { return name === 'uiConversation' ? { userText: this.userText } : undefined; },
    effect(start) { const cleanup = start(); effects.add(cleanup); return () => { if (effects.delete(cleanup)) cleanup(); }; },
    close() { for (const cleanup of [...effects]) { effects.delete(cleanup); cleanup(); } },
  };
}
function fixture() {
  const events = new Set(), errors = new Set(), scopes = new Map();
  const entries = ['text', 'session', 'file', 'folder', 'skill', 'command', 'secret'].map(key => ({ options: { key } }));
  const factories = new Map(['conversation.user.text', 'conversation.chat.user.content'].map(name => [name, [{
    type: 'factory', name, scope: 'session', children: name === 'conversation.user.text'
      ? [{ type: 'slot', name: NODE_SLOT, kind: 'keyed', scope: 'session' }] : [],
  }]]));
  const slots = {
    entries,
    entriesOfSlot(key) { assert.equal(key, NODE_SLOT); return [...this.entries]; },
    snapshot(key) { return structuredClone(factories.get(key.slice('factory:'.length)) ?? []); },
    onEntryError(listener) { errors.add(listener); return () => errors.delete(listener); },
  };
  const api = registry(), a = scope(api); scopes.set('a', a);
  const ctx = {
    get(name) { return name === 'slots' ? slots : name === 'sessions' ? { scope: id => scopes.get(id) } : undefined; },
    on(name, listener) { assert.equal(name, 'slots/changed'); events.add(listener); return () => events.delete(listener); },
  };
  return { ctx, slots, api, a, scopes, events, errors, factories,
    emit: key => { for (const listener of [...events]) listener(key); },
    crash: (key, entry, info = { abdicated: false }) => { for (const listener of [...errors]) listener(key, entry, Error('synthetic renderer failure'), info); },
  };
}

test('retained Session scope owns evaluator lookup and repeated projections reuse its callback', () => {
  const f = fixture();
  const binding = createUserProjectionBinding(f.ctx);
  assert.deepEqual(values(binding.project(source())), ['hello']);
  assert.deepEqual(values(binding.project(source('second'))), ['second']);
  assert.equal(f.api.creates, 1);
  assert.equal(f.api.listeners.size, 1);
  binding.dispose();
});

test('missing Session or scoped evaluator never borrows a root or another Session evaluator', () => {
  const f = fixture();
  const rootApi = registry();
  f.ctx.uiConversation = { userText: rootApi };
  const binding = createUserProjectionBinding(f.ctx);
  const missing = binding.project(source('PRIVATE', 'not-retained'));
  assert.deepEqual(missing.blocks, []);
  assert.equal(missing.errors[0].code, 'user-session-unavailable');
  f.scopes.set('b', scope(undefined));
  const unavailable = binding.project(source('PRIVATE', 'b'));
  assert.equal(unavailable.errors[0].code, 'user-projection-unavailable');
  assert.equal(rootApi.creates, 0);
  assert.equal(f.api.creates, 0);
  assert.ok(!JSON.stringify([missing, unavailable]).includes('PRIVATE'));
  binding.dispose();
});

test('separate Sessions get separate evaluator callbacks even with a shared registry subscription', () => {
  const f = fixture(); f.scopes.set('b', scope(f.api));
  let changes = 0;
  const binding = createUserProjectionBinding(f.ctx, () => changes++);
  binding.project(source('A')); binding.project(source('B', 'b'));
  assert.equal(f.api.creates, 2);
  assert.equal(f.api.listeners.size, 1);
  f.api.change();
  assert.equal(changes, 1);
  binding.dispose();
  assert.equal(f.api.listeners.size, 0);
});

test('registry revisions invalidate old results and current rules are evaluated again', () => {
  const f = fixture(); let changes = 0;
  const binding = createUserProjectionBinding(f.ctx, () => changes++);
  assert.deepEqual(values(binding.project(source('secret'))), ['secret']);
  f.api.change(input => [{ id: 'secret', start: 0, end: input.text.length, data: { masked: '******' } }]);
  assert.equal(changes, 1);
  const result = binding.project(source('secret'));
  assert.deepEqual(values(result), ['******']);
  assert.equal(result.defaultMasked, true);
  assert.equal(f.api.creates, 1);
  binding.dispose();
});

test('same-key replacement is partial only for affected nodes and restoring original winner recovers', () => {
  const f = fixture(); let changes = 0;
  const binding = createUserProjectionBinding(f.ctx, () => changes++);
  assert.deepEqual(values(binding.project(source())), ['hello']);
  const original = f.slots.entries.find(entry => entry.options.key === 'secret');
  f.slots.entries = f.slots.entries.map(entry => entry === original ? { options: { key: 'secret' } } : entry);
  f.emit(NODE_SLOT);
  assert.equal(changes, 1);
  assert.deepEqual(values(binding.project(source())), ['hello']);
  f.api.evaluate = input => [{ id: 'secret', start: 0, end: input.text.length, data: { masked: '*****' } }];
  assert.equal(binding.project(source()).errors[0].code, 'user-renderer-unavailable');
  f.slots.entries = f.slots.entries.map(entry => entry.options.key === 'secret' ? original : entry);
  f.emit(NODE_SLOT);
  assert.deepEqual(values(binding.project(source())), ['*****']);
  assert.equal(changes, 2);
  binding.dispose();
});

test('missing or unknown active node keys never authorize raw fallback', () => {
  for (const id of ['text', 'third-party']) {
    const f = fixture();
    if (id === 'text') f.slots.entries = f.slots.entries.filter(entry => entry.options.key !== id);
    else { f.slots.entries.push({ options: { key: id } }); f.api.evaluate = input => [{ id, start: 0, end: input.text.length, data: { label: 'invented' } }]; }
    const binding = createUserProjectionBinding(f.ctx);
    const result = binding.project(source('PRIVATE'));
    assert.deepEqual(result.blocks, []);
    assert.equal(result.errors[0].code, 'user-renderer-unavailable');
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
    binding.dispose();
  }
});

test('a later added node key is not adopted as the original baseline', () => {
  const f = fixture();
  f.slots.entries = f.slots.entries.filter(entry => entry.options.key !== 'secret');
  const binding = createUserProjectionBinding(f.ctx);
  assert.deepEqual(values(binding.project(source())), ['hello']);
  f.slots.entries.push({ options: { key: 'secret' } }); f.emit(NODE_SLOT);
  f.api.evaluate = input => [{ id: 'secret', start: 0, end: input.text.length, data: { masked: '***' } }];
  assert.equal(binding.project(source()).errors[0].code, 'user-renderer-unavailable');
  binding.dispose();
});

test('delayed initial Factory and node registrations become usable before baseline capture', () => {
  const f = fixture(); let changes = 0;
  const initialFactories = new Map(f.factories), initialEntries = f.slots.entries;
  f.factories.clear(); f.slots.entries = [];
  const binding = createUserProjectionBinding(f.ctx, () => changes++);
  assert.equal(binding.project(source()).errors[0].code, 'user-renderer-unavailable');
  for (const [name, tree] of initialFactories) {
    f.factories.set(name, tree); f.emit(`factory:${name}`);
    assert.equal(binding.project(source()).errors[0].code, 'user-renderer-unavailable');
  }
  f.slots.entries = initialEntries; f.emit(NODE_SLOT);
  assert.deepEqual(values(binding.project(source())), ['hello']);
  assert.equal(changes, 3);
  assert.equal(f.api.creates, 1);
  // The same event is conservative after capture, not reclassified as startup.
  f.emit('factory:conversation.user.text');
  assert.equal(binding.project(source()).errors[0].code, 'user-renderer-unavailable');
  binding.dispose();
});

test('the first usable projection captures registrations, not the plugin constructor', () => {
  const f = fixture();
  f.slots.entries = f.slots.entries.filter(entry => entry.options.key !== 'secret');
  const binding = createUserProjectionBinding(f.ctx);
  f.api.evaluate = input => [{ id: 'secret', start: 0, end: input.text.length, data: { masked: '***' } }];
  assert.equal(binding.project(source()).errors[0].code, 'user-renderer-unavailable');
  f.slots.entries.push({ options: { key: 'secret' } }); f.emit(NODE_SLOT);
  assert.deepEqual(values(binding.project(source())), ['***']);
  f.slots.entries = f.slots.entries.map(entry => entry.options.key === 'secret' ? { options: { key: 'secret' } } : entry);
  f.emit(NODE_SLOT);
  assert.equal(binding.project(source()).errors[0].code, 'user-renderer-unavailable');
  binding.dispose();
});

test('startup nodes can arrive in batches without requiring unrelated known keys', () => {
  const f = fixture();
  const initialEntries = f.slots.entries;
  f.slots.entries = [];
  const binding = createUserProjectionBinding(f.ctx);
  f.api.evaluate = input => [{ id: 'secret', start: 0, end: input.text.length, data: { masked: '***' } }];
  f.slots.entries.push(initialEntries.find(entry => entry.options.key === 'file')); f.emit(NODE_SLOT);
  assert.equal(binding.project(source()).errors[0].code, 'user-renderer-unavailable');
  f.slots.entries.push(initialEntries.find(entry => entry.options.key === 'secret')); f.emit(NODE_SLOT);
  assert.deepEqual(values(binding.project(source())), ['***']);
  // The first complete projection establishes the baseline, not every batch.
  f.slots.entries.push(initialEntries.find(entry => entry.options.key === 'text')); f.emit(NODE_SLOT);
  f.api.evaluate = input => text(input.text);
  assert.equal(binding.project(source()).errors[0].code, 'user-renderer-unavailable');
  binding.dispose();

  const plain = fixture(); plain.slots.entries = [plain.slots.entries[0]];
  const plainBinding = createUserProjectionBinding(plain.ctx);
  assert.deepEqual(values(plainBinding.project(source())), ['hello']);
  plainBinding.dispose();
});

test('an unsupported first projection neither authorizes unknown nodes nor freezes startup entries', () => {
  const f = fixture();
  f.slots.entries.push({ options: { key: 'third-party' } });
  f.api.evaluate = input => [{ id: 'third-party', start: 0, end: input.text.length, data: { label: 'PRIVATE' } }];
  const binding = createUserProjectionBinding(f.ctx);
  const result = binding.project(source('PRIVATE'));
  assert.equal(result.errors[0].code, 'user-renderer-unavailable');
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  f.slots.entries = f.slots.entries.map(entry => entry.options.key === 'text' ? { options: { key: 'text' } } : entry);
  f.emit(NODE_SLOT); f.emit('factory:conversation.user.text');
  f.api.evaluate = input => text(input.text);
  assert.deepEqual(values(binding.project(source())), ['hello']);
  binding.dispose();
});

test('missing Session at startup does not capture an incomplete renderer baseline', () => {
  const f = fixture(); f.scopes.delete('a'); f.factories.clear();
  const binding = createUserProjectionBinding(f.ctx);
  assert.equal(binding.project(source()).errors[0].code, 'user-session-unavailable');
  const ready = fixture();
  for (const [name, tree] of ready.factories) { f.factories.set(name, tree); f.emit(`factory:${name}`); }
  f.scopes.set('a', f.a);
  assert.deepEqual(values(binding.project(source())), ['hello']);
  binding.dispose();
});

test('renderer errors observed before the first projection are not forgotten as startup', () => {
  for (const key of [NODE_SLOT, 'factory:conversation.user.text', 'factory:conversation.chat.user.content']) {
    const f = fixture(); const binding = createUserProjectionBinding(f.ctx);
    f.crash(key, f.slots.entries.find(entry => entry.options.key === 'text'));
    f.emit(key);
    assert.equal(binding.project(source()).errors[0].code, 'user-renderer-unavailable');
    binding.dispose();
  }
});

test('only relevant Slot/Factory changes invalidate, and Factory replacements remain conservative', () => {
  for (const name of ['conversation.user.text', 'conversation.chat.user.content']) {
    const f = fixture(); let changes = 0;
    const binding = createUserProjectionBinding(f.ctx, () => changes++);
    for (const key of ['root', 'conversation.input', 'factory:other', 'conversation.chat.user.images']) f.emit(key);
    assert.equal(changes, 0);
    assert.deepEqual(values(binding.project(source())), ['hello']);
    f.emit(`factory:${name}`); // Same JSON cannot prove it is the same Factory.
    assert.equal(changes, 1);
    assert.deepEqual(binding.project(source()).blocks, []);
    f.emit(`factory:${name}`);
    assert.equal(binding.project(source()).errors[0].code, 'user-renderer-unavailable');
    binding.dispose();
  }
});

test('public Factory error events invalidate even without a registration mutation', () => {
  const f = fixture(); let changes = 0;
  const binding = createUserProjectionBinding(f.ctx, () => changes++);
  f.crash('factory:other'); assert.equal(changes, 0);
  f.crash('factory:conversation.user.text'); assert.equal(changes, 1);
  assert.equal(binding.project(source()).errors[0].code, 'user-renderer-unavailable');
  binding.dispose();
});

test('a non-abdicated node crash remains partial despite the unchanged effective winner', () => {
  const f = fixture(); let changes = 0;
  const binding = createUserProjectionBinding(f.ctx, () => changes++);
  const original = f.slots.entries.find(entry => entry.options.key === 'secret');
  f.api.evaluate = input => [{ id: 'secret', start: 0, end: input.text.length, data: { masked: '*****' } }];
  assert.deepEqual(values(binding.project(source())), ['*****']);
  f.crash(NODE_SLOT, original);
  assert.equal(changes, 1);
  assert.equal(binding.project(source()).errors[0].code, 'user-renderer-unavailable');
  f.emit(NODE_SLOT); f.api.change(); // Neither proves that the renderer recovered.
  assert.equal(binding.project(source()).errors[0].code, 'user-renderer-unavailable');
  f.api.evaluate = input => text(input.text);
  assert.deepEqual(values(binding.project(source())), ['hello']);
  binding.dispose();
});

test('a crashed node recovers only after its effective winner changes back to the original entry', () => {
  const f = fixture(); const binding = createUserProjectionBinding(f.ctx);
  const original = f.slots.entries.find(entry => entry.options.key === 'text');
  binding.project(source()); f.crash(NODE_SLOT, original);
  f.slots.entries = f.slots.entries.map(entry => entry === original ? { options: { key: 'text' } } : entry);
  f.emit(NODE_SLOT);
  assert.equal(binding.project(source()).errors[0].code, 'user-renderer-unavailable');
  f.slots.entries = f.slots.entries.map(entry => entry.options.key === 'text' ? original : entry);
  f.emit(NODE_SLOT);
  assert.deepEqual(values(binding.project(source())), ['hello']);
  binding.dispose();
});

test('abdication ordering and later original-entry restoration are handled through the public crash channel', () => {
  const f = fixture(); const binding = createUserProjectionBinding(f.ctx);
  const original = f.slots.entries.find(entry => entry.options.key === 'text');
  binding.project(source());
  f.slots.entries = f.slots.entries.filter(entry => entry !== original);
  f.emit(NODE_SLOT); // Official ordinary-entry mutation precedes onEntryError.
  f.crash(NODE_SLOT, original, { abdicated: true });
  assert.equal(binding.project(source()).errors[0].code, 'user-renderer-unavailable');
  f.slots.entries.push(original); f.emit(NODE_SLOT);
  assert.deepEqual(values(binding.project(source())), ['hello']);
  binding.dispose();
});

test('an unidentifiable node crash conservatively marks known nodes rather than guessing raw fallback', () => {
  const f = fixture(); const binding = createUserProjectionBinding(f.ctx);
  f.crash(NODE_SLOT, {});
  assert.equal(binding.project(source()).errors[0].code, 'user-renderer-unavailable');
  f.emit(NODE_SLOT);
  assert.equal(binding.project(source()).errors[0].code, 'user-renderer-unavailable');
  binding.dispose();
});

test('missing or malformed public Factory inspection fails closed without throwing at construction', () => {
  for (const mutate of [
    f => f.factories.delete('conversation.user.text'),
    f => f.factories.get('conversation.chat.user.content')[0].scope = 'root',
    f => f.factories.get('conversation.user.text')[0].children = [],
    f => f.slots.snapshot = () => { throw Error('PRIVATE'); },
    f => f.slots.entriesOfSlot = undefined,
    f => f.ctx.on = undefined,
  ]) {
    const f = fixture(); mutate(f);
    const binding = createUserProjectionBinding(f.ctx);
    const result = binding.project(source());
    assert.equal(result.errors[0].code, 'user-renderer-unavailable');
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
    binding.dispose();
  }
  const old = createUserProjectionBinding({});
  assert.equal(old.project(source()).errors[0].code, 'user-session-unavailable');
  old.dispose();
});

test('replacing a Session generation releases the old evaluator watch and acquires an independent one', () => {
  const f = fixture(); const binding = createUserProjectionBinding(f.ctx);
  binding.project(source());
  const nextApi = registry(), next = scope(nextApi);
  f.scopes.set('a', next);
  assert.deepEqual(values(binding.project(source('new generation'))), ['new generation']);
  assert.equal(f.api.listeners.size, 0);
  assert.equal(f.a.effects.size, 0);
  assert.equal(nextApi.creates, 1);
  assert.equal(nextApi.listeners.size, 1);
  binding.dispose();
  assert.equal(next.effects.size, 0);
});

test('scope lifecycle cleanup invalidates cached results and disposes registry observers', () => {
  const f = fixture(); let changes = 0;
  const binding = createUserProjectionBinding(f.ctx, () => changes++);
  binding.project(source()); f.scopes.delete('a'); f.a.close();
  assert.equal(changes, 1);
  assert.equal(f.api.listeners.size, 0);
  assert.equal(binding.project(source()).errors[0].code, 'user-session-unavailable');
  binding.dispose();
});

test('dispose is idempotent, releases all watches, ignores later events and cannot revive projection', () => {
  const f = fixture(); let changes = 0;
  const binding = createUserProjectionBinding(f.ctx, () => changes++);
  binding.project(source()); binding.dispose(); binding.dispose();
  assert.equal(f.events.size, 0); assert.equal(f.errors.size, 0);
  assert.equal(f.api.listeners.size, 0); assert.equal(f.a.effects.size, 0);
  f.emit(NODE_SLOT); f.crash('factory:conversation.user.text'); f.api.change();
  assert.equal(changes, 0);
  assert.equal(binding.project(source()).errors[0].code, 'user-projection-disposed');
});

test('a consumer change callback failure cannot break Host publication or projection', () => {
  const f = fixture();
  const binding = createUserProjectionBinding(f.ctx, () => { throw Error('consumer failure'); });
  binding.project(source());
  assert.doesNotThrow(() => f.api.change());
  assert.doesNotThrow(() => f.emit(NODE_SLOT));
  assert.deepEqual(values(binding.project(source())), ['hello']);
  binding.dispose();
});
