// Uses the official Session/JSONL seams exercised by these host tests:
// https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/apps/web/tests/chat-scroll-fixture.ts
// https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/apps/web/tests/scaffold.ts
// https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/apps/web/tests/scaffold.ts
// No model is called: every synthetic turn is already closed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function seedHistory(runtimeRequire, home, workspace, { sidebarChild = false } = {}) {
  const load = name => import(pathToFileURL(runtimeRequire.resolve(name)).href);
  const { Session, SessionId, SESSION_FORMAT_VERSION } = await load('@deepseek-ai/dsh-session');
  const { createUserMessage, createAssistantMessage, createSystemMessage } = await load('@deepseek-ai/dsh-llm');
  const { Context } = await load('@deepseek-ai/cordis');
  const { default: Jsonl } = await load('@deepseek-ai/dsh-session-persistence-jsonl');
  const descriptor = sidebarChild ? (await load('@deepseek-ai/dsh-subagent')).snapshotSubagentDescriptor : null;
  const createdAt = Date.now() - 60_000;
  fs.mkdirSync(workspace, { recursive: true });
  const ctx = new Context();
  const summary = [];
  try {
    await ctx.plugin(Jsonl, { root: path.join(home, '.dsh', 'sessions') });
    for (const label of sidebarChild ? ['A', 'B', 'C'] : ['A', 'B']) {
      const id = SessionId(`find-all-synthetic-${label.toLowerCase()}`);
      const session = Session.create(id);
      for (let turn = 1; turn <= 80; turn++) {
        session.append('turn/start', { turn });
        session.append('step/start', { turn, step: 1 });
        if (turn === 1) session.append('system/message', {
          turn, step: 1, message: createSystemMessage('Synthetic compatibility fixture.', '@deepseek-ai/dsh-system-prompt'),
        }, { surfaceOp: 'append' });
        const suffix = String(turn).padStart(3, '0');
        const user = session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: `FIND_ALL_${label}_USER_${suffix} synthetic user` }], source: { kind: 'user' },
        }), { surfaceOp: 'append' });
        // Official rc2 subagent-conversation.e2e.ts authors completed one-shot
        // child headers, descriptor events and parent catalog entries without
        // asking a model. Keep A/B root histories unchanged and add child C.
        if (turn === 1 && sidebarChild && label === 'A') session.append('subagent/catalog', {
          version: 0, childId: SessionId('find-all-synthetic-c'), childCreatedAt: createdAt,
          mode: 'one-shot', label: 'FIND_ALL_CHILD_SIDEBAR',
        });
        if (turn === 1 && sidebarChild && label === 'C') session.append('subagent/descriptor', descriptor({
          mode: 'one-shot', provider: 'spawn', label: 'FIND_ALL_CHILD_SIDEBAR',
        }));
        if (turn === 1) session.append('session/title', {
          title: `FIND_ALL_${label} synthetic compatibility`, messageSeqs: [user.seq], source: { kind: 'fallback' },
        });
        session.append('request/header', {
          header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }, reason: turn === 1 ? 'initial' : 'change',
        });
        session.append('assistant/message', {
          stream: [], turn, step: 1,
          message: createAssistantMessage({
            content: [{ type: 'text', text: `FIND_ALL_${label}_REPLY_${suffix} synthetic reply` }],
            source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
          }),
          usage: { inputTokens: 1, outputTokens: 1 },
        }, { surfaceOp: 'append' });
        session.append('step/end', { turn, step: 1 });
        session.append('turn/end', { turn, reason: { kind: 'completed' } });
      }
      const events = session.snapshotEvents();
      assert.equal(events.at(-1).type, 'turn/end');
      const handle = await ctx.sessionPersistence.create({
        version: SESSION_FORMAT_VERSION, id, createdAt,
        isSeeded: false, cwd: workspace, delegationDepth: label === 'C' ? 1 : 0,
        ...(label === 'C' ? { parentSession: SessionId('find-all-synthetic-a'), origin: 'subagent' } : {}),
      });
      await handle.append(events);
      await handle.close();
      summary.push({ id, events: events.length, turns: 80 });
    }
  } finally { await ctx.fiber.dispose(); }
  return summary;
}

export async function exerciseSidebarIsolation(page, home, queryPath, capture, profile = 'web') {
  // Use the official rc2 Subagent catalog/Sidebar controls. Do not fabricate
  // a second DOM pane: it must be rendered by the real host from child C.
  // https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/apps/web/tests/subagent-conversation.e2e.ts
  await page.getByRole('button', { name: '1 subagent', exact: true }).hover();
  await page.getByRole('treeitem', { name: /FIND_ALL_CHILD_SIDEBAR/ })
    .getByRole('button', { name: 'Open FIND_ALL_CHILD_SIDEBAR in sidebar', exact: true }).click();
  const sidebar = page.locator('[data-sidebar-chat]');
  await sidebar.getByText('FIND_ALL_C_USER_080 synthetic user', { exact: true }).waitFor();
  const content = sidebar.locator('[data-conversation-content]');
  assert.equal(await content.getAttribute('data-conversation-session'), 'find-all-synthetic-c');
  assert.equal(await content.getAttribute('data-content-phase'), 'active');
  assert.equal(await sidebar.locator('[data-find-all-session]').count(), 0, 'official embedded view has no utility anchor');
  const anchor = page.locator('[data-find-all-session="find-all-synthetic-a"]');
  try {
    // Native re-enable creates a pristine plugin while both real panes remain.
    setFixturePatch(home, queryPath, true, profile);
    await eventually(() => page.locator('[data-find-all-session]').count(), 0, 'disable before neutral multi-view regression');
    setFixturePatch(home, queryPath, false, profile);
    await anchor.waitFor({ state: 'visible' });
    await page.evaluate(() => document.activeElement?.blur());
    assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
    await page.keyboard.press('Control+f');
    const bar = page.locator('#dsh-find-all-root');
    await bar.locator('input').fill('FIND_ALL_A_USER_');
    await page.waitForTimeout(1200);
    assert.equal(await bar.locator('.count').innerText(), '0/0', 'main plus headerless sidebar is ambiguous on first neutral shortcut');
    assert.match(await bar.locator('.status').innerText(), /Select a visible conversation|Search scope unavailable/);
    assert.equal(await page.evaluate(() => CSS.highlights.has('dsh-find-all-hit')), false);
    await capture('sidebar-neutral-ambiguity');
    // At the installed Desktop's 1024px width the find bar overlaps the main
    // header utility. Dismiss it normally before selecting that visible control.
    await page.keyboard.press('Escape');
    await bar.waitFor({ state: 'hidden' });
    await anchor.click();
    await bar.locator('input').fill('FIND_ALL_A_USER_');
    await eventually(() => bar.locator('.count').innerText(), '1/80', 'explicit main selection remains available beside a sidebar');
    const scoped = await page.evaluate(() => {
      const flow = document.querySelector('[data-conversation-session="find-all-synthetic-a"] [data-chat-flow]');
      return [...CSS.highlights.get('dsh-find-all-hit')].every(range => flow.contains(range.startContainer));
    });
    assert.equal(scoped, true);
    await page.keyboard.press('Escape');
    await sidebar.getByText('FIND_ALL_C_USER_080 synthetic user', { exact: true }).click();
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Control+f');
    await bar.locator('input').fill('FIND_ALL_A_USER_');
    await page.waitForTimeout(1200);
    assert.equal(await bar.locator('.count').innerText(), '0/0', 'unsupported sidebar interaction must not search main A');
    await capture('sidebar-explicit-rejection');
    return { layout: 'official rc2 embedded subagent sidebar', neutralAmbiguity: 'passed', explicitMainScope: 'passed', explicitSidebarRejection: 'passed', nativeResetCycles: 1 };
  } finally {
    await page.keyboard.press('Escape');
    const close = page.locator('[data-sidebar-right-panel] [data-dockkit-tab-close]');
    assert.equal(await close.count(), 1);
    await close.click();
    await sidebar.waitFor({ state: 'detached' });
  }
}

export function setFixturePatch(home, queryPath, disabled = false, profile = 'web') {
  assert.ok(['web', 'desktop'].includes(profile), 'only owned Web/Desktop fixture profiles are allowed');
  const file = path.join(home, '.dsh', 'profiles', profile, 'cordis.patch.yml');
  // Both profiles use the official live profile patch reload mode. JSON is valid YAML.
  const patches = [
    // The official Web scaffold also disables background LLM title generation.
    { id: 'session-title-llm', disabled: true },
    { id: 'session-query-sqlite', config: { path: queryPath, openAt: 'first-search' } },
    { id: 'find-all', disabled },
  ];
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(patches));
  fs.renameSync(`${file}.tmp`, file);
}

async function eventually(read, expected, label, timeout = 30_000) {
  const until = Date.now() + timeout;
  let value;
  while (Date.now() < until) {
    value = await read();
    if (value === expected) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(value, expected, label);
}

export async function exerciseHistory(page, home, queryPath, capture, version, profile = 'web') {
  const refreshRequired = ['0.1.5-rc.2', '0.1.5-rc.3', '0.1.6-alpha.1'].includes(version);
  // CLI profiles group these seeds under their actual temporary workspace;
  // the upstream scaffold's 'Ungrouped' barrier does not apply to this layout.
  await page.getByRole('button', { name: 'Search sessions' }).waitFor({ state: 'visible', timeout: 30_000 });
  async function openSession(label) {
    const searchButton = page.getByRole('button', { name: 'Search sessions' });
    if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click();
    await page.getByRole('textbox', { name: /^(Search sessions\.\.\.|Search session names)$/ }).fill(`FIND_ALL_${label}_USER_001`);
    const results = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem');
    await eventually(() => results.count(), 1, 'synthetic session search result', 60_000);
    await results.click();
    await page.getByRole('tab', { name: 'Chat', exact: true }).waitFor({ timeout: 30_000 });
    await page.locator('[data-chat-flow]').getByText(`FIND_ALL_${label}_USER_080 synthetic user`, { exact: true }).waitFor();
    const anchor = page.locator(`[data-find-all-session="find-all-synthetic-${label.toLowerCase()}"]`);
    await anchor.waitFor({ state: 'visible' });
    return anchor;
  }
  const visited = new Set();
  for (const label of ['A', 'B', 'A']) {
    const anchor = await openSession(label);
    if (!visited.has(label)) {
      const rendered = await page.locator('[data-chat-flow]').innerText();
      const initial = rendered.split(`FIND_ALL_${label}_USER_`).length - 1;
      assert.ok(initial > 0 && initial < 80, 'fixture must start partially loaded to test actual paging');
      visited.add(label);
    }
    if (label === 'A' && visited.size === 1) {
      // Regression: no anchor click or conversation-focus preparation. Start
      // with body focus after the host has mounted its session header utility.
      await page.evaluate(() => document.activeElement?.blur());
      assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
      await page.keyboard.press('Control+f');
    } else await anchor.click();
    const bar = page.locator('#dsh-find-all-root');
    await bar.locator('input').fill(`FIND_ALL_${label}_USER_`);
    if (await bar.locator('.scope').innerText() === 'Loaded content') await bar.locator('.scope').click();
    await eventually(() => bar.locator('.count').innerText(), '1/80', 'whole history must be scoped and completely paged', 60_000);
    await eventually(() => bar.locator('.status').innerText(), 'Searched currently available history; the host offers no earlier pages, so completeness cannot be confirmed', 'host history exhaustion must be explicit', 60_000);
    const ranges = await page.evaluate(() => [...(CSS.highlights.get('dsh-find-all-hit') || [])].map(range => range.toString()));
    assert.equal(ranges.length, 80);
    assert.ok(ranges.every(text => text === `FIND_ALL_${label}_USER_`));
    await page.keyboard.press('F3');
    assert.equal(await bar.locator('.count').innerText(), '2/80');
    await page.keyboard.press('Shift+F3');
    assert.equal(await bar.locator('.count').innerText(), '1/80');
    await capture(`history-${label}`);
    await page.keyboard.press('Escape');
  }
  // Old official HMR clients deliberately ignore graph frames. A fresh SSE
  // connection reads the server's actual graph before we test a required reload.
  async function graphContainsPlugin() {
    return page.evaluate(() => new Promise((resolve, reject) => {
      const source = new EventSource('/plugins/events');
      const timer = setTimeout(() => { source.close(); reject(new Error('graph handshake timeout')); }, 5000);
      source.onmessage = event => {
        const frame = JSON.parse(event.data);
        if (frame.type !== 'graph') return;
        clearTimeout(timer);
        source.close();
        resolve(frame.graph.entries.some(row => row.id === '@ryuu-64/dsh-find-all'));
      };
      source.onerror = () => { clearTimeout(timer); source.close(); reject(new Error('graph handshake failed')); };
    }));
  }
  // Toggle the actual installed plugin through the official live profile patch.
  // Modern hosts must not reload. The two legacy hosts require explicit reloads.
  let navigations = 0;
  const navigation = frame => { if (frame === page.mainFrame()) navigations++; };
  page.on('framenavigated', navigation);
  try {
    for (let cycle = 0; cycle < 2; cycle++) {
      await page.locator('[data-find-all-session]').click();
      await page.locator('#dsh-find-all-root input').fill('FIND_ALL_A_USER_');
      setFixturePatch(home, queryPath, true, profile);
      if (refreshRequired) {
        await eventually(graphContainsPlugin, false, 'server graph acknowledges disable');
        assert.equal(await page.locator('#dsh-find-all-root').count(), 1, 'legacy host does not hot-unload graph entries');
        await page.reload({ waitUntil: 'load' });
        await page.getByRole('button', { name: 'Search sessions' }).click();
      }
      await eventually(() => page.locator('#dsh-find-all-root').count(), 0, 'disable removes the find bar after the supported lifecycle');
      assert.equal(await page.locator('[data-find-all-session]').count(), 0);
      assert.equal(await page.evaluate(() => CSS.highlights.has('dsh-find-all-hit')), false);
      await page.keyboard.press('Control+f');
      assert.equal(await page.locator('#dsh-find-all-root').count(), 0);
      setFixturePatch(home, queryPath, false, profile);
      if (refreshRequired) {
        await eventually(graphContainsPlugin, true, 'server graph acknowledges re-enable');
        await page.reload({ waitUntil: 'load' });
        await openSession('A');
      }
      await page.locator('[data-find-all-session]').waitFor({ state: 'visible', timeout: 30_000 });
      assert.equal(await page.locator('[data-find-all-session]').count(), 1);
      await page.locator('[data-find-all-session]').click();
      assert.equal(await page.locator('#dsh-find-all-root').count(), 1);
      await page.locator('#dsh-find-all-root input').fill('FIND_ALL_A_USER_');
      await eventually(() => page.locator('#dsh-find-all-root .count').innerText(), '1/80', 'find works once after re-enable');
      await page.keyboard.press('Escape');
    }
    assert.equal(navigations, refreshRequired ? 4 : 0, 'only legacy lifecycle may require explicit page reloads');
  } finally { page.off('framenavigated', navigation); }
  return { histories: ['A', 'B', 'A'], firstBodyShortcutWithoutAnchorClick: 'passed', turnsPerSession: 80, nativeHotUnload: refreshRequired ? 'unsupported-by-host' : 'passed', hotCycles: refreshRequired ? 0 : 2, refreshCycles: refreshRequired ? 2 : 0 };
}
