// Real RC2 Chat renders all rows. These fixtures author Session events and
// substitute only deterministic LLM output through the official replay plugin.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CASES = [
  ['POINTER', 'pointer', false], ['ENTER', 'Enter', false], ['SPACE', 'Space', false],
  ['PAGING_POINTER', 'pointer', true], ['PAGING_ENTER', 'Enter', true], ['PAGING_SPACE', 'Space', true],
];
const sessionId = label => `find-all-return-${label.toLowerCase()}`;
const userMarker = (label, turn) => `RETURN_${label}_USER_${String(turn).padStart(3, '0')}`;
const paragraphMarker = (label, index) => `RETURN_${label}_PARAGRAPH_${String(index).padStart(2, '0')}`;

export async function seedReturnHistory(runtimeRequire, home, workspace) {
  const load = name => import(pathToFileURL(runtimeRequire.resolve(name)).href);
  const { Session, SessionId, SESSION_FORMAT_VERSION } = await load('@deepseek-ai/dsh-session');
  const { createUserMessage, createAssistantMessage, createSystemMessage } = await load('@deepseek-ai/dsh-llm');
  const { Context } = await load('@deepseek-ai/cordis');
  const { default: Jsonl } = await load('@deepseek-ai/dsh-session-persistence-jsonl');
  fs.mkdirSync(workspace, { recursive: true });
  const ctx = new Context();
  const summaries = [];
  try {
    await ctx.plugin(Jsonl, { root: path.join(home, '.dsh', 'sessions') });
    for (const label of [...CASES.map(item => item[0]), 'STREAM', 'REPEATED', 'CANCEL_WHEEL', 'CANCEL_QUERY', 'CANCEL_ESCAPE', 'MULTIWINDOW']) {
      const id = SessionId(sessionId(label));
      const session = Session.create(id);
      for (let turn = 1; turn <= 80; turn++) {
        session.append('turn/start', { turn });
        session.append('step/start', { turn, step: 1 });
        if (turn === 1) session.append('system/message', { turn, step: 1,
          message: createSystemMessage('Synthetic reading-position acceptance fixture.', '@deepseek-ai/dsh-system-prompt'),
        }, { surfaceOp: 'append' });
        const user = session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: `${userMarker(label, turn)} Synthetic reader request.` }], source: { kind: 'user' },
        }), { surfaceOp: 'append' });
        if (turn === 1) session.append('session/title', { title: `RETURN_${label} reading-position fixture`,
          messageSeqs: [user.seq], source: { kind: 'fallback' },
        });
        session.append('request/header', { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
          reason: turn === 1 ? 'initial' : 'change',
        });
        const reply = turn === 80 ? Array.from({ length: 42 }, (_, index) =>
          `${paragraphMarker(label, index)} This distinct paragraph identifies a reading position inside a long assistant message. `
          + 'Returning should preserve this passage when older messages load or the text wraps at another viewport width. '
          + 'Its neighboring paragraphs deliberately share ordinary words, while this marker and its semantic node remain unique.'
        ).join('\n\n') : `RETURN_${label}_REPLY_${String(turn).padStart(3, '0')} Settled synthetic reply.`;
        session.append('assistant/message', { stream: [], turn, step: 1,
          message: createAssistantMessage({ content: [{ type: 'text', text: reply }],
            source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }),
          usage: { inputTokens: 1, outputTokens: 1 },
        }, { surfaceOp: 'append' });
        session.append('step/end', { turn, step: 1 });
        session.append('turn/end', { turn, reason: { kind: 'completed' } });
      }
      const events = session.snapshotEvents();
      const handle = await ctx.sessionPersistence.create({ version: SESSION_FORMAT_VERSION, id,
        createdAt: Date.now() - 60_000, isSeeded: false, cwd: workspace, delegationDepth: 0,
      });
      await handle.append(events);
      await handle.close();
      summaries.push({ id, turns: 80, events: events.length, longMessageParagraphs: 42 });
    }
  } finally { await ctx.fiber.dispose(); }
  return summaries;
}

export function writeReturnOverlay(runtimeRequire, home, queryPath, run) {
  const parts = Array.from({ length: 300 }, (_, index) => index === 299 ? 'RETURN_LIVE_DONE.'
    : `RETURN_LIVE_${String(index).padStart(3, '0')} Incremental text changes the real Chat layout while a reader inspects history.\n\n`);
  const chunks = [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...parts.map(text => ({ type: 'text-delta', index: 0, text })),
    { type: 'block-end', index: 0, block: { type: 'text', text: parts.join('') } },
    { type: 'usage', usage: { inputTokens: 512, outputTokens: 4096 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ];
  const overrideFile = path.join(run, 'return-replay.override.json');
  fs.writeFileSync(overrideFile, JSON.stringify([{ kind: 'chunks', chunks }]));
  const overlay = path.join(run, 'return.overlay.json');
  fs.writeFileSync(overlay, JSON.stringify([
    { id: 'session-title-llm', disabled: true },
    { id: 'session-query-sqlite', config: { path: queryPath, openAt: 'first-search' } },
    { id: 'llm-deepseek', disabled: true },
    { id: 'llm-pi-ai', disabled: true },
    { id: 'agent-default-model', config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
    { insert: [{ id: 'return-llm-replay', name: runtimeRequire.resolve('@deepseek-ai/dsh-llm-replay'), config: {
      file: path.join(run, 'override-only.jsonl'), overrideFile, paceMs: 120,
      providers: [{ id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-v4-flash', contextWindow: 10_000_000 }] }],
    } }] },
  ]));
  return overlay;
}

async function eventually(read, predicate, label, timeout = 20_000) {
  const until = Date.now() + timeout;
  let value;
  do {
    value = await read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 80));
  } while (Date.now() < until);
  throw new Error(`${label}: ${JSON.stringify(value)}`);
}

async function openSession(page, label) {
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1400, height: 900 });
  const search = page.getByRole('button', { name: 'Search sessions', exact: true });
  await search.waitFor({ state: 'visible', timeout: 30_000 });
  if (await search.getAttribute('aria-expanded') !== 'true') await search.click();
  await page.getByRole('textbox', { name: 'Search session names', exact: true }).fill(userMarker(label, 1));
  const results = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem');
  await eventually(() => results.count(), n => n === 1, 'one seeded session result', 60_000);
  await results.click();
  await page.locator(`[data-find-all-session="${sessionId(label)}"]`).waitFor({ state: 'visible' });
  await page.locator('[data-chat-flow]').first().getByText(paragraphMarker(label, 41), { exact: false }).waitFor();
  await page.waitForTimeout(700);
  const initialUsers = await page.locator('[data-chat-flow]').first().evaluate((flow, prefix) =>
    (flow.textContent.match(new RegExp(prefix, 'g')) || []).length, `RETURN_${label}_USER_`);
  assert.ok(initialUsers > 0 && initialUsers < 80, 'each case must start with real partially loaded history');
  return initialUsers;
}

// All preparation uses trusted Playwright input. No dispatchEvent, fake wheel,
// injected pointer/beforematch, DOM replacement, or host-private controller access.
async function positionParagraph(page, marker) {
  const paragraph = page.locator('[data-chat-flow] p').filter({ hasText: marker });
  await eventually(() => paragraph.count(), n => n === 1, 'unique long-message paragraph');
  const scroll = page.locator('[data-conversation-scroll]');
  const box = await scroll.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.35);
  for (let pass = 0; pass < 3; pass++) {
    const delta = (await witnessForMarker(page, marker)).top - 4;
    if (Math.abs(delta) <= 2) break;
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(700);
  }
  const witness = await witnessForMarker(page, marker);
  assert.ok(Math.abs(witness.top - 4) <= 3, `trusted wheel must place long-message paragraph at reading line: ${witness.top}`);
  assert.ok(witness.offset > 1000, 'origin must be inside the long message, not its start');
  return witness;
}

async function witnessForMarker(page, marker) {
  return page.locator('[data-chat-flow]').first().evaluate((flow, needle) => {
    const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT);
    let text;
    while ((text = walker.nextNode())) {
      const local = text.data.indexOf(needle);
      if (local < 0) continue;
      const row = text.parentElement.closest('[data-chat-anchor-key]');
      if (!row) continue;
      const words = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      let item, offset = 0;
      while ((item = words.nextNode())) {
        if (item === text) break;
        if (!item.parentElement.closest('button, input, textarea, select, [data-code-block-banner]')
          && item.parentElement.closest('[data-chat-anchor-key]') === row) offset += item.data.length;
      }
      const range = document.createRange();
      range.setStart(text, local); range.setEnd(text, local + 1);
      const rect = range.getBoundingClientRect();
      const scroll = row.closest('[data-conversation-scroll]');
      return { anchorKey: row.dataset.chatAnchorKey, nodeKey: row.dataset.chatNodeKey,
        offset: offset + local, marker: needle, top: rect.top - scroll.getBoundingClientRect().top,
        scrollTop: scroll.scrollTop, distanceFromBottom: scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop,
        paragraphHeight: text.parentElement.closest('p')?.getBoundingClientRect().height ?? null,
        paragraph: text.parentElement.closest('p')?.textContent ?? text.data };
    }
    throw new Error(`Marker not mounted: ${needle}`);
  }, marker);
}

async function startSearch(page, label, whole, origin) {
  if (label === 'MULTIWINDOW') await page.evaluate(() => window.__recordReturnSelection('before-find', document.activeElement));
  await page.keyboard.press('Control+f');
  const bar = page.locator('#dsh-find-all-root');
  await bar.waitFor({ state: 'visible' });
  const expectedScope = whole ? '1' : null;
  if (await bar.locator('.scope').getAttribute('data-whole') !== expectedScope) await bar.locator('.scope').click();
  await bar.locator('input').fill(userMarker(label, whole ? 1 : 79));
  await eventually(() => bar.locator('.count').innerText(), text => /^(0|1)\/1$/.test(text), 'one search result is available', 60_000);
  if (whole) {
    await eventually(() => bar.locator('.status').innerText(),
      text => text === 'Matches found; press Enter to navigate. Searched currently available history; the host offers no earlier pages, so completeness cannot be confirmed',
      'available-history scan completion', 60_000);
    assert.equal(await bar.locator('[data-find-all-return]').isHidden(), true, 'background paging is not a reader navigation');
    const beforeNavigation = await witnessForMarker(page, origin.marker);
    assert.ok(Math.abs(beforeNavigation.top - origin.top) <= 4, 'background history loading must preserve the passage');
    await bar.locator('input').press('Enter');
  }
  await eventually(async () => {
    const button = bar.locator('[data-find-all-return]');
    return { visible: await button.isVisible(), enabled: await button.isEnabled() };
  }, state => state.visible && state.enabled, 'return visible and enabled after actual navigation');
  return bar;
}

async function activateReturn(page, bar, mode) {
  const button = bar.locator('[data-find-all-return]');
  if (mode === 'pointer') await button.click();
  else {
    await button.focus();
    await page.keyboard.press(mode);
  }
}

async function settledResult(page, bar, witness, timeout = 5000) {
  const state = await eventually(async () => ({ hidden: !(await bar.isVisible()),
    status: await bar.locator('.status').innerText(),
  }), state => state.hidden || /Unable|could not|failed|Cannot|not keep|no longer|not available/i.test(state.status), 'return settles visibly', timeout);
  await page.waitForTimeout(1200);
  const after = await witnessForMarker(page, witness.marker);
  return { ...state, after, geometryDelta: after.top - witness.top,
    sameAnchor: after.anchorKey === witness.anchorKey && after.nodeKey === witness.nodeKey,
    sameParagraph: after.offset === witness.offset && after.paragraph === witness.paragraph };
}

export async function exerciseReturnPosition(page, capture) {
  const reports = [];
  for (const [label, mode, nativePaging] of CASES) {
    const record = { case: label, activation: mode, nativePaging, result: 'pending' };
    reports.push(record);
    try {
      record.initialUsers = await openSession(page, label);
      record.before = await positionParagraph(page, paragraphMarker(label, 20));
      const bar = await startSearch(page, label, !nativePaging, record.before);
      const searched = await witnessForMarker(page, record.before.marker);
      assert.ok(Math.abs(searched.top - record.before.top) > 200, 'search must visibly leave the origin');
      if (nativePaging) {
        const beforeRows = await page.locator('[data-chat-node-key]').count();
        // Locator click may scroll the real button into view. The pointerdown
        // occurs before its loadEarlier handler retains a fresh paging anchor.
        await page.getByRole('button', { name: 'Load earlier', exact: true }).click();
        await eventually(() => page.locator('[data-chat-node-key]').count(), n => n > beforeRows, 'official Load earlier committed');
        await page.waitForTimeout(800);
        record.nativePage = { beforeRows, afterRows: await page.locator('[data-chat-node-key]').count(),
          completedBeforeReturn: true };
      } else if (mode === 'Enter') {
        // RC2's responsive scenario uses a real 700px browser viewport:
        // https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/apps/web/tests/chat-scroll-contract.e2e.ts#L1010-L1014
        // Avoid its sidebar click here: focus changes are a separate test.
        // Observe actual wrapping after at most two real viewport changes.
        const attempts = [];
        for (const width of [700, 560]) {
          await page.setViewportSize({ width, height: 900 });
          await page.waitForTimeout(250);
          const wrapped = await witnessForMarker(page, record.before.marker);
          attempts.push({ width, paragraphHeight: wrapped.paragraphHeight });
          if (wrapped.paragraphHeight > record.before.paragraphHeight) break;
        }
        const last = attempts.at(-1);
        record.reflow = { beforeWidth: 1400, afterWidth: last.width, beforeHeight: record.before.paragraphHeight,
          afterHeight: last.paragraphHeight, attempts };
        assert.ok(last.paragraphHeight > record.before.paragraphHeight, 'narrowing must actually reflow the origin paragraph');
      }
      await capture(`${label.toLowerCase()}-before-return`);
      const inputStart = await page.evaluate(() => window.__returnInputEvidence.length);
      const hostInputStart = await page.evaluate(() => window.__hostTurnInputEvidence.length);
      await activateReturn(page, bar, mode);
      record.return = await settledResult(page, bar, record.before);
      record.inputEvents = await page.evaluate(start => window.__returnInputEvidence.slice(start), inputStart);
      record.hostTurnEvents = await page.evaluate(start => window.__hostTurnInputEvidence.slice(start), hostInputStart);
      if (nativePaging && record.return.hidden) assert.ok(record.hostTurnEvents.some(event => !event.trusted),
        'plugin should normally click the host Turn control; this is programmatic, not a trusted reading event');
      assert.ok(record.inputEvents.some(event => event.type === 'click' && event.trusted), 'return must receive a trusted browser click');
      assert.ok(record.inputEvents.every(event => !event.insideScrollport), 'fixture return control must be outside the host scrollport');
      await capture(`${label.toLowerCase()}-after-return`);
      if (nativePaging && !record.return.hidden) {
        // Keep the initial failure as a failure. Separately observe whether a
        // real reader wheel releases host paging and lets the user retry.
        const box = await page.locator('[data-conversation-scroll]').boundingBox();
        await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.35);
        await page.mouse.wheel(0, 120);
        await page.waitForTimeout(700);
        await activateReturn(page, bar, mode);
        record.recovery = await settledResult(page, bar, record.before);
        record.recovery.afterTrustedWheel = true;
        record.recovery.result = record.recovery.hidden && record.recovery.sameAnchor && record.recovery.sameParagraph
          && Math.abs(record.recovery.geometryDelta) <= 4 ? 'passed' : 'failed';
        await capture(`${label.toLowerCase()}-wheel-retry`);
      }
      assert.ok(record.return.hidden, `return must finish and close the bar: ${record.return.status}`);
      assert.ok(record.return.sameAnchor && record.return.sameParagraph, 'same semantic node, paragraph, and text offset');
      assert.ok(Math.abs(record.return.geometryDelta) <= 4, `return must restore passage geometry: ${record.return.geometryDelta}`);
      record.result = 'passed';
    } catch (error) {
      record.result = 'failed'; record.error = String(error);
      try { record.status = await page.locator('#dsh-find-all-root .status').innerText(); } catch {}
      try { await capture(`${label.toLowerCase()}-failure`); } catch {}
    }
  }
  const stream = { case: 'STREAM', result: 'pending', source: 'official dsh-llm-replay; real agent and SSE' };
  reports.push(stream);
  try {
    await openSession(page, 'STREAM');
    await page.locator('[data-composer-input][contenteditable="true"]').last().fill('RETURN_LIVE_USER Continue with the deterministic replay stream.');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.locator('[data-chat-flow]').first().getByText('RETURN_LIVE_000', { exact: false }).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1200);
    stream.followingBeforeSearch = await page.locator('[data-conversation-scroll]').evaluate(s => s.scrollHeight - s.clientHeight - s.scrollTop < 25);
    assert.ok(stream.followingBeforeSearch, 'host must be following the live tail before search');
    // Open find directly while the host owns bottom following. Choose a real
    // visible live paragraph as an independent Range witness; do not wheel or
    // click the transcript first, since that would already cancel tail intent.
    const liveMarker = await eventually(() => page.locator('[data-chat-flow]').first().evaluate(flow => {
      const top = flow.closest('[data-conversation-scroll]').getBoundingClientRect().top;
      for (const paragraph of flow.querySelectorAll('p')) {
        const marker = paragraph.textContent.match(/RETURN_LIVE_\d{3}/)?.[0];
        const rect = paragraph.getBoundingClientRect();
        const row = paragraph.closest('[data-chat-node-key]');
        if (marker && row?.getBoundingClientRect().top <= top && rect.top >= top && rect.top < top + 48) return marker;
      }
      return null;
    }), marker => marker !== null, 'live output must fill the reading line', 10_000);
    assert.ok(liveMarker, 'live stream must have a stable visible paragraph witness');
    stream.before = await witnessForMarker(page, liveMarker);
    await page.keyboard.press('Control+f');
    const bar = page.locator('#dsh-find-all-root');
    if (await bar.locator('.scope').getAttribute('data-whole') !== null) await bar.locator('.scope').click();
    await bar.locator('input').fill(userMarker('STREAM', 79));
    await eventually(async () => {
      const button = bar.locator('[data-find-all-return]');
      return { visible: await button.isVisible(), enabled: await button.isEnabled() };
    }, state => state.visible && state.enabled, 'streaming return visible and enabled');
    const firstLiveLength = await page.locator('[data-chat-flow]').first().evaluate(flow => flow.textContent.length);
    await page.waitForTimeout(1400);
    stream.liveGrowthDuringSearch = await page.locator('[data-chat-flow]').first().evaluate(flow => flow.textContent.length) - firstLiveLength;
    assert.ok(stream.liveGrowthDuringSearch > 300, 'real SSE stream must grow while search is open');
    stream.searchHeldAwayFromTail = await page.evaluate(() => {
      const scroll = document.querySelector('[data-conversation-scroll]');
      const viewport = scroll.getBoundingClientRect();
      const ranges = [...(CSS.highlights.get('dsh-find-all-hit') || [])];
      return scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop > 1000
        && ranges.some(range => [...range.getClientRects()].some(rect => rect.bottom > viewport.top && rect.top < viewport.bottom));
    });
    assert.ok(stream.searchHeldAwayFromTail, 'search navigation must cancel existing bottom-follow intent');
    await page.setViewportSize({ width: 700, height: 900 });
    await activateReturn(page, bar, 'pointer');
    stream.return = await settledResult(page, bar, stream.before);
    const firstReturn = stream.return.after;
    await page.waitForTimeout(1500);
    stream.afterFurtherGrowth = await witnessForMarker(page, stream.before.marker);
    await capture('stream-after-return');
    assert.ok(stream.return.hidden && stream.return.sameAnchor && stream.return.sameParagraph, 'streaming return must restore and close');
    assert.ok(Math.abs(stream.return.geometryDelta) <= 48, 'width reflow must preserve the original live passage within two line heights');
    assert.ok(Math.abs(stream.afterFurtherGrowth.top - firstReturn.top) <= 4, 'later stream growth must not pull reader to tail');
    assert.ok(stream.afterFurtherGrowth.distanceFromBottom > 1000, 'tail following must remain cancelled');
    await page.locator('[data-chat-flow]').first().getByText('RETURN_LIVE_DONE.', { exact: false }).waitFor({ timeout: 60_000 });
    stream.finished = true;
    stream.result = 'passed';
  } catch (error) {
    stream.result = 'failed'; stream.error = String(error);
    try { await capture('stream-failure'); } catch {}
  }
  await exerciseRepeatedReturn(page, capture, reports);
  for (const mode of ['WHEEL', 'QUERY', 'ESCAPE']) await exerciseReturnCancellation(page, capture, reports, mode);
  await exerciseWindowIsolation(page, capture, reports);
  return reports;
}

function assertReturned(result) {
  assert.ok(result.hidden, `return finishes visibly: ${result.status}`);
  assert.ok(result.sameAnchor && result.sameParagraph, 'return retains semantic node, paragraph, and offset');
  assert.ok(Math.abs(result.geometryDelta) <= 4, `return geometry delta ${result.geometryDelta}`);
}

async function nativePage(page) {
  const beforeRows = await page.locator('[data-chat-node-key]').count();
  await page.getByRole('button', { name: 'Load earlier', exact: true }).click();
  await eventually(() => page.locator('[data-chat-node-key]').count(), n => n > beforeRows, 'native page grows Chat');
  await page.waitForTimeout(700);
  return { beforeRows, afterRows: await page.locator('[data-chat-node-key]').count() };
}

async function exerciseRepeatedReturn(page, capture, reports) {
  const record = { case: 'REPEATED', result: 'pending', cycles: [] };
  reports.push(record);
  try {
    await openSession(page, 'REPEATED');
    for (const paragraph of [16, 27]) {
      const before = await positionParagraph(page, paragraphMarker('REPEATED', paragraph));
      const bar = await startSearch(page, 'REPEATED', false, before);
      const native = await nativePage(page);
      const eventStart = await page.evaluate(() => window.__hostTurnInputEvidence.length);
      await activateReturn(page, bar, 'pointer');
      const result = await settledResult(page, bar, before);
      const hostTurnEvents = await page.evaluate(start => window.__hostTurnInputEvidence.slice(start), eventStart);
      record.cycles.push({ before, native, return: result, hostTurnEvents });
      assertReturned(result);
      assert.ok(hostTurnEvents.some(event => !event.trusted && event.owningSessionId === sessionId('REPEATED')), 'programmatic Turn click belongs to this session view');
    }
    await capture('repeated-return');
    record.result = 'passed';
  } catch (error) {
    record.result = 'failed'; record.error = String(error);
    try { await capture('repeated-failure'); } catch {}
  }
}

// Delay the real older-page RPC only; no response data or Chat objects are
// substituted. This is the official upstream browser fixture's gate:
// https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/apps/web/tests/chat-scroll-contract.e2e.ts#L606-L625
async function holdOlderPage(page) {
  let held = false, release;
  const gate = new Promise(resolve => { release = resolve; });
  const handler = async route => {
    const request = route.request().postDataJSON();
    if (!held && request?.method === 'session/page' && request.payload?.args?.request?.beforeSeq !== undefined) {
      held = true;
      await gate;
    }
    await route.continue();
  };
  await page.route('**/api/session/page', handler);
  return { get held() { return held; }, release, close: async () => { release(); await page.unroute('**/api/session/page', handler); } };
}

async function visibleFixtureWitness(page) {
  const marker = await page.locator('[data-chat-flow]').first().evaluate(flow => {
    const scroll = flow.closest('[data-conversation-scroll]');
    const viewport = scroll.getBoundingClientRect();
    const bottom = scroll.querySelector('[data-composer-seat]')?.getBoundingClientRect().top ?? viewport.bottom;
    const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT);
    let text, best = null;
    while ((text = walker.nextNode())) {
      const match = /RETURN_[A-Z_]+_(?:USER_\d{3}|REPLY_\d{3}|PARAGRAPH_\d{2})/.exec(text.data);
      if (!match || !text.parentElement.closest('[data-chat-node-key]')) continue;
      const range = document.createRange(); range.setStart(text, match.index); range.setEnd(text, match.index + 1);
      const rect = range.getBoundingClientRect();
      if (rect.bottom <= viewport.top + 1 || rect.top >= bottom || rect.width <= 0) continue;
      const distance = Math.abs(rect.top - viewport.top);
      if (!best || distance < best.distance) best = { marker: match[0], distance };
    }
    return best?.marker ?? null;
  });
  assert.ok(marker, 'cancellation leaves a real identifiable visible passage');
  return witnessForMarker(page, marker);
}

async function exerciseReturnCancellation(page, capture, reports, mode) {
  const label = `CANCEL_${mode}`;
  const record = { case: label, result: 'pending' };
  reports.push(record);
  let gate;
  try {
    await openSession(page, label);
    record.origin = await positionParagraph(page, paragraphMarker(label, 20));
    const bar = await startSearch(page, label, false, record.origin);
    const beforeRows = await page.locator('[data-chat-node-key]').count();
    gate = await holdOlderPage(page);
    await page.getByRole('button', { name: 'Load earlier', exact: true }).click();
    await eventually(() => gate.held, yes => yes, 'real older RPC held');
    await activateReturn(page, bar, 'pointer');
    await eventually(() => bar.locator('.status').innerText(), text => text === 'Returning…', 'return actually entered waiting state', 5000);
    assert.equal(await bar.locator('[data-find-all-return]').isEnabled(), false, 'return is pending');
    record.cancelledWhile = 'Returning… with real session/page RPC pending';
    if (mode === 'WHEEL') {
      const box = await page.locator('[data-conversation-scroll]').boundingBox();
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.35);
      await page.mouse.wheel(0, 180);
      await eventually(() => bar.locator('.status').innerText(), text => text === 'Return cancelled', 'wheel cancels return');
    } else if (mode === 'QUERY') await bar.locator('input').fill(userMarker(label, 78));
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    record.atCancel = await visibleFixtureWitness(page);
    const clicksAfterCancel = await page.evaluate(() => window.__hostTurnInputEvidence.length);
    gate.release();
    await eventually(() => page.locator('[data-chat-node-key]').count(), n => n > beforeRows, 'cancelled return does not block shared host paging');
    await page.waitForTimeout(1200);
    record.afterLatePage = await witnessForMarker(page, record.atCancel.marker);
    record.lateTurnEvents = await page.evaluate(start => window.__hostTurnInputEvidence.slice(start), clicksAfterCancel);
    record.barVisible = await bar.isVisible();
    record.query = await bar.locator('input').inputValue();
    record.session = await page.locator('[data-conversation-content][data-content-phase="active"]').getAttribute('data-conversation-session');
    record.geometryDelta = record.afterLatePage.top - record.atCancel.top;
    assert.equal(record.session, sessionId(label), 'late completion retains current session');
    assert.deepEqual(record.lateTurnEvents, [], 'cancelled return cannot late-activate the host Turn control');
    assert.equal(record.barVisible, mode !== 'ESCAPE', 'cancelled return cannot later close or reopen the bar');
    if (mode === 'QUERY') assert.equal(record.query, userMarker(label, 78), 'new query survives late history');
    assert.equal(record.afterLatePage.nodeKey, record.atCancel.nodeKey, 'late prepend preserves the current semantic message');
    assert.equal(record.afterLatePage.offset, record.atCancel.offset, 'late prepend preserves the current paragraph offset');
    assert.ok(Math.abs(record.geometryDelta) <= 4, `late history must preserve current visible passage: ${record.geometryDelta}`);
    await capture(`${label.toLowerCase()}-after-late-page`);
    record.result = 'passed';
  } catch (error) {
    record.result = 'failed'; record.error = String(error);
    try { await capture(`${label.toLowerCase()}-failure`); } catch {}
  } finally { await gate?.close(); }
}

async function exerciseWindowIsolation(page, capture, reports) {
  const record = { case: 'MULTIWINDOW', result: 'pending', sameBrowserContext: true, sameSession: sessionId('MULTIWINDOW') };
  reports.push(record);
  let other;
  try {
    await openSession(page, 'MULTIWINDOW');
    record.firstOrigin = await positionParagraph(page, paragraphMarker('MULTIWINDOW', 12));
    const firstBar = await startSearch(page, 'MULTIWINDOW', false, record.firstOrigin);
    other = await page.context().newPage();
    await other.setViewportSize({ width: 1400, height: 900 });
    await other.goto(new URL('/', page.url()).href, { waitUntil: 'load' });
    await other.locator('style[data-plugin-css="dsh-find-all/bar.css"]').waitFor({ state: 'attached', timeout: 30_000 });
    await openSession(other, 'MULTIWINDOW');
    record.secondOrigin = await positionParagraph(other, paragraphMarker('MULTIWINDOW', 28));
    const secondBar = await startSearch(other, 'MULTIWINDOW', false, record.secondOrigin);
    const firstWhileSecondSearches = await witnessForMarker(page, record.firstOrigin.marker);
    await activateReturn(other, secondBar, 'Space');
    record.secondReturn = await settledResult(other, secondBar, record.secondOrigin);
    assertReturned(record.secondReturn);
    const firstAfterOtherReturn = await witnessForMarker(page, record.firstOrigin.marker);
    record.firstWindowCrossDelta = firstAfterOtherReturn.top - firstWhileSecondSearches.top;
    assert.ok(Math.abs(record.firstWindowCrossDelta) <= 4, 'second window return cannot scroll first window');
    assert.equal(await firstBar.isVisible(), true, 'second window cannot close first window find');
    await activateReturn(page, firstBar, 'Enter');
    record.firstReturn = await settledResult(page, firstBar, record.firstOrigin);
    assertReturned(record.firstReturn);
    const secondAfterFirstReturn = await witnessForMarker(other, record.secondOrigin.marker);
    record.secondWindowCrossDelta = secondAfterFirstReturn.top - record.secondReturn.after.top;
    assert.ok(Math.abs(record.secondWindowCrossDelta) <= 4, 'first window return cannot scroll second window');
    assert.notEqual(record.firstOrigin.offset, record.secondOrigin.offset, 'two windows retain different paragraphs in the same semantic node');
    record.secondHostTurnEvents = await other.evaluate(() => window.__hostTurnInputEvidence);
    record.secondUntrustedReadingEvents = await other.evaluate(() => window.__untrustedReadingEvents);
    assert.deepEqual(record.secondUntrustedReadingEvents, [], 'second window receives no fabricated reading events');
    await capture('multiwindow-first-return', page);
    await capture('multiwindow-second-return', other);
    record.result = 'passed';
  } catch (error) {
    record.result = 'failed'; record.error = String(error);
    try { await capture('multiwindow-first-failure', page); } catch {}
    if (other) try { await capture('multiwindow-second-failure', other); } catch {}
  } finally {
    for (const [name, target] of [['firstSelectionEvidence', page], ['secondSelectionEvidence', other]]) {
      if (target) try { record[name] = await target.evaluate(() => { window.__recordReturnSelection('case-end', document.activeElement); return window.__returnSelectionEvidence; }); } catch {}
    }
    await other?.close();
  }
}
