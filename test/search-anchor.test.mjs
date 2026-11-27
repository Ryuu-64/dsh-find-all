import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanObservation } from '../lib/search-host.js';
import { projectAnchor } from '../src/search-anchor.js';

const project = ({ raw }) => ({ blocks: raw.replace(/\[[^\]]+\]\([^)]+\)/gu, 'link').replaceAll('`', '')
  .split('\n\n').map(text => ({ text })) });

test('the first saved match retains its exact range after Markdown projection', async () => {
  const raw = 'Intro\n\nUse `DOMAIN` for the entry and `DOMAIN` for the fallback.';
  const observation = {
    cursor: 4,
    events: [{ type: 'assistant/message', surfaceOp: 'append', seq: 3, data: { turn: 1, step: 1,
      message: { id: 'reply', content: [{ type: 'reasoning', text: 'DOMAIN' }, { type: 'text', text: raw }] } } }],
  };
  const { message: anchor, snippet, ranges: [range] } = await scanObservation(observation, 'domain', new AbortController().signal);
  assert.deepEqual([anchor.messageId, anchor.seq, anchor.contentIndex, anchor.start], ['reply', 3, 1, raw.indexOf('DOMAIN')]);
  const hit = projectAnchor(project, { raw }, { anchor, snippet, range });
  assert.deepEqual([hit.blockIndex, hit.start, hit.end, hit.text], [1, 4, 10, 'DOMAIN']);
  assert.equal(projectAnchor(project, { raw: raw.replace('entry', 'route') }, { anchor, snippet, range }), null);
});

test('a hidden raw match does not jump to a second occurrence in the rendered message', () => {
  const raw = '[reference](DOMAIN) followed by DOMAIN';
  const start = raw.indexOf('DOMAIN');
  const end = start + 'DOMAIN'.length;
  const hit = projectAnchor(project, { raw }, {
    anchor: { start, end, excerptStart: 0, excerptEnd: raw.length }, snippet: raw, range: { start, end },
  });
  assert.equal(hit, null);
});
