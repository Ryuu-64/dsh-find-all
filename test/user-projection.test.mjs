import test from 'node:test';
import assert from 'node:assert/strict';
import { createUserTextProjector, projectUserTextNodes } from '../src/user-projection.js';

const textNode = (text, start = 0, display) => ({
  id: 'text', start, end: start + text.length,
  data: { text, ...(display === undefined ? {} : { display }) },
});
const source = (raw, extra = {}) => ({ kind: 'user', sourceKind: 'user', sessionId: 'session-a', raw, ...extra });
const verified = { verifyRenderer: () => true };
const registry = evaluate => ({ createEvaluator: () => evaluate });
const values = projection => projection.blocks.map(block => block.text);

test('plain official nodes preserve literal markup, whitespace, newlines and UTF-16 text', () => {
  const raw = '  literal **bold** and <x> 😀\t下一行\nend  ';
  const result = projectUserTextNodes([textNode(raw)], raw);
  assert.deepEqual(result, { blocks: [{ text: raw, index: 0 }], mapping: 'user', userTextSemantics: 'official-inline', errors: [] });
});

test('known official nodes project their inline display labels, not path or title metadata', () => {
  const parts = [
    ['text', 'hello ', { text: 'hello ' }],
    ['session', '@[Visible label](dsh-session:private-id)', { label: 'Visible label' }],
    ['text', ' ', { text: ' ' }],
    ['file', '@"private/path.txt"', { label: 'path.txt', path: 'private/path.txt' }],
    ['folder', '@private/folder/', { label: 'folder', path: 'private/folder/' }],
    ['skill', '/demo', { name: 'demo' }],
    ['command', '/goal', { name: 'goal' }],
  ];
  let raw = '';
  const nodes = parts.map(([id, spelling, data]) => {
    const start = raw.length;
    raw += spelling;
    return { id, start, end: raw.length, data };
  });
  const projection = projectUserTextNodes(nodes, raw);
  assert.deepEqual(values(projection), ['hello Visible label path.txtfolder/demo/goal']);
  assert.deepEqual(projection.errors, []);
  assert.ok(!JSON.stringify(projection).includes('private'));
});

test('text display replacements honor the official nullish semantics including empty text', () => {
  const raw = '  a\t\nb  ';
  const nodes = [textNode('  ', 0, ''), textNode('a', 2), textNode('\t\n', 3, ' '), textNode('b', 5, null), textNode('  ', 6, '')];
  assert.deepEqual(values(projectUserTextNodes(nodes, raw)), ['a b']);
});

test('modern evaluator results explicitly identify official inline mapping, including known partial blocks', () => {
  const project = createUserTextProjector(registry(input => [textNode(input.text)]), verified);
  assert.equal(project(source('hello')).userTextSemantics, 'official-inline');
  const partial = projectUserTextNodes([
    textNode('left'), { id: 'unknown', start: 4, end: 7, data: {} }, textNode('right', 7),
  ], 'leftrawright');
  assert.equal(partial.userTextSemantics, 'official-inline');
  assert.deepEqual(values(partial), ['left', 'right']);
  assert.equal(partial.errors[0].code, 'unsupported-user-node');
});

test('secret defaults only to the official masked display, with no original or reveal data retained', () => {
  const raw = 'before sk-FAKE_ONLY_TEST_CREDENTIAL after';
  const original = 'sk-FAKE_ONLY_TEST_CREDENTIAL';
  const start = raw.indexOf(original), end = start + original.length;
  const nodes = [textNode(raw.slice(0, start)), { id: 'secret', start, end, data: { masked: 'sk-************TIAL', raw: original, revealed: true } }, textNode(raw.slice(end), end)];
  const result = projectUserTextNodes(nodes, raw);
  assert.deepEqual(values(result), ['before sk-************TIAL after']);
  assert.deepEqual(result.errors, []);
  assert.equal(result.defaultMasked, true);
  assert.ok(!JSON.stringify(result).includes(original));
  nodes[1].data.masked = undefined;
  const invalid = projectUserTextNodes(nodes, raw);
  assert.deepEqual(values(invalid), ['before ', ' after']);
  assert.equal(invalid.errors[0].code, 'unsupported-user-node');
  assert.equal(invalid.defaultMasked, true);
  assert.ok(!JSON.stringify(invalid).includes(original));
});

test('unknown nodes and invalid business data are partial and break cross-gap matches', () => {
  for (const middle of [
    { id: 'third-party', data: { label: 'invented' } },
    { id: 'image', data: { alt: 'not an official inline node' } },
    { id: 'paste', data: { text: 'not an official inline node' } },
    { id: 'file', data: { path: 'hidden/path', label: 7 } },
    { id: 'text', data: { text: 'incorrect' } },
    { id: 'text', data: { text: 'raw', display: {} } },
  ]) {
    const result = projectUserTextNodes([textNode('left'), { ...middle, start: 4, end: 7 }, textNode('right', 7)], 'leftrawright');
    assert.deepEqual(values(result), ['left', 'right']);
    assert.equal(result.errors[0].code, 'unsupported-user-node');
    assert.ok(!JSON.stringify(result).includes('leftright'));
    assert.ok(!values(result).join('').includes('raw'));
  }
});

test('malformed, gapped, overlapping, unordered or incomplete ranges fail closed', () => {
  const raw = 'hello';
  const invalid = [
    undefined, {}, [null], [],
    [textNode('hell')], [textNode('ello', 1)],
    [textNode('hel'), textNode('llo', 2)],
    [{ ...textNode('hello'), start: -0 }],
    [{ ...textNode('hello'), end: 1.5 }],
    [{ ...textNode('hello'), end: 6 }],
    [textNode('', 0), textNode('hello')],
    [textNode('lo', 3), textNode('hel')],
    [textNode('h'), textNode('llo', 2)],
  ];
  for (const nodes of invalid) {
    const result = projectUserTextNodes(nodes, raw);
    assert.deepEqual(result.blocks, []);
    assert.equal(result.errors[0].code, 'invalid-user-projection');
  }
});

test('an empty evaluated document and wholly trimmed text are supported empty projections', () => {
  assert.deepEqual(projectUserTextNodes([], ''), { blocks: [], mapping: 'user', userTextSemantics: 'official-inline', errors: [] });
  assert.deepEqual(projectUserTextNodes([textNode('  ', 0, '')], '  '), { blocks: [], mapping: 'user', userTextSemantics: 'official-inline', errors: [] });
});

test('the public evaluator is created once per projector and receives durable source facts', () => {
  let creates = 0;
  const seen = [];
  const api = { createEvaluator() { creates += 1; return input => { seen.push(input); return [textNode(input.text)]; }; } };
  const project = createUserTextProjector(api, { ...verified, sessionId: 'session-a' });
  const facts = { sessionLabels: ['label'], skillNames: ['demo'] };
  const first = source('one', { userTextFacts: facts, referenceLabels: ['must not replace durable facts'] });
  const second = source('two', { userTextFacts: { sessionLabels: ['new label'] } });
  assert.deepEqual(values(project(first)), ['one']);
  assert.deepEqual(values(project(second)), ['two']);
  assert.equal(creates, 1);
  assert.equal(seen[0].facts, facts);
  assert.deepEqual(seen.map(input => input.text), ['one', 'two']);
  assert.deepEqual(seen[1].facts, second.userTextFacts);
  assert.deepEqual(first.userTextFacts, facts);
});

test('legacy durable label and skill fields supply facts only when modern facts are absent', () => {
  const seen = [];
  const project = createUserTextProjector(registry(input => { seen.push(input.facts); return [textNode(input.text)]; }), verified);
  project(source('one', { referenceLabels: ['label'], skillNames: ['demo'] }));
  project(source('two', { userTextFacts: {}, referenceLabels: ['not used'], skillNames: ['not used'] }));
  project(source('three'));
  assert.deepEqual(seen, [{ sessionLabels: ['label'], skillNames: ['demo'] }, {}, {}]);
});

test('independent session projectors own independent evaluator callbacks and reject cross-session sources', () => {
  const seen = [];
  let creates = 0;
  const api = { createEvaluator() { const instance = creates++; return input => { seen.push([instance, input.text]); return [textNode(input.text)]; }; } };
  const a = createUserTextProjector(api, { ...verified, sessionId: 'session-a' });
  const b = createUserTextProjector(api, { ...verified, sessionId: 'session-b' });
  a(source('A'));
  b(source('B', { sessionId: 'session-b' }));
  const wrong = a(source('private wrong session', { sessionId: 'session-b' }));
  assert.deepEqual(seen, [[0, 'A'], [1, 'B']]);
  assert.equal(wrong.errors[0].code, 'user-session-mismatch');
  assert.deepEqual(wrong.blocks, []);
});

test('invalid supplied durable facts never become plausible empty facts or raw text', () => {
  let evaluations = 0;
  const project = createUserTextProjector(registry(() => { evaluations += 1; return []; }), verified);
  for (const facts of [null, [], 'invalid', { sessionLabels: {} }, { skillNames: [3] }, { trimWhitespace: 'yes' }, { collapseWhitespace: 1 }, { commands: [null] }, { commands: [{ start: 2, end: 1, name: 'goal' }] }]) {
    const result = project(source('private raw', { userTextFacts: facts }));
    assert.deepEqual(result.blocks, []);
    assert.equal(result.errors[0].code, 'invalid-user-facts');
  }
  assert.equal(evaluations, 0);
});

test('missing or failed public evaluator is a projection gap and never copies private errors', () => {
  for (const api of [undefined, {}, { createEvaluator: () => undefined }, { createEvaluator() { throw Error('PRIVATE_CONSTRUCTION_CAUSE'); } }]) {
    const result = createUserTextProjector(api, verified)(source('PRIVATE_RAW'));
    assert.equal(result.errors[0].code, 'user-projection-unavailable');
    assert.deepEqual(result.blocks, []);
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  }
  const result = createUserTextProjector(registry(() => { throw Error('PRIVATE_EVALUATION_CAUSE'); }), verified)(source('PRIVATE_RAW'));
  assert.equal(result.errors[0].code, 'user-transform-failed');
  assert.deepEqual(result.blocks, []);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('explicitly failed, invalid, asynchronous and throwing renderer verifiers never index raw fallback', () => {
  for (const verifyRenderer of [null, false, () => false, () => undefined, () => 'true', () => Promise.resolve(true), () => { throw Error('PRIVATE_RENDERER_CAUSE'); }]) {
    const result = createUserTextProjector(registry(input => [textNode(input.text)]), { verifyRenderer })(source('PRIVATE_RAW'));
    assert.equal(result.errors[0].code, 'user-renderer-unavailable');
    assert.deepEqual(result.blocks, []);
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  }
});

test('without an optional renderer guard the adapter implements only known official node semantics', () => {
  const project = createUserTextProjector(registry(input => [textNode(input.text)]));
  assert.deepEqual(values(project(source('hello'))), ['hello']);
  const unknown = createUserTextProjector(registry(() => [{ id: 'custom', start: 0, end: 5, data: { label: 'must not guess' } }]));
  const result = unknown(source('hello'));
  assert.deepEqual(result.blocks, []);
  assert.equal(result.errors[0].code, 'unsupported-user-node');
});

test('renderer verification receives original nodes and durable source without a second evaluation', () => {
  const original = source('hello');
  const nodes = [textNode('hello')];
  let calls = 0;
  const project = createUserTextProjector(registry(() => { calls += 1; return nodes; }), {
    verifyRenderer(actualNodes, actualSource) {
      assert.equal(actualNodes, nodes);
      assert.equal(actualSource, original);
      return true;
    },
  });
  assert.deepEqual(values(project(original)), ['hello']);
  assert.equal(calls, 1);
});
