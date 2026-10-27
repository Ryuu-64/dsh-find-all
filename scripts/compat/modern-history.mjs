// Exact-host browser acceptance for modern whole-history search. Real Chat rows,
// native pointer/keyboard actions and CSS Highlight Ranges; no fabricated DOM.
import assert from 'node:assert/strict';

async function eventually(read, predicate, label, timeout = 60_000) {
  const until = Date.now() + timeout;
  let value;
  while (Date.now() < until) {
    value = await read();
    if (typeof predicate === 'function' ? predicate(value) : value === predicate) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`${label}: observed ${JSON.stringify(value)}`);
}

async function setScope(page, bar, scope) {
  const radio = page.locator(`#dsh-find-all-root-content-panel input[type="radio"][value="${scope}"]`);
  if (await radio.isChecked()) return;
  const menu = bar.locator('.content-filter');
  if (await menu.getAttribute('aria-expanded') !== 'true') await menu.click();
  await radio.check();
  if (await menu.getAttribute('aria-expanded') === 'true') await menu.click();
}
function completeCount(value, count) {
  return count === 0 ? value === 'No results' : value === `${count} results` || new RegExp(`^\\d+/${count}$`).test(value);
}

async function replaceFindQuery(bar, query) {
  const input = bar.locator('input.query');
  await input.fill('');
  await eventually(() => bar.locator('.count:visible').innerText(), 'Type to find', 'cleared query generation');
  assert.equal(await bar.evaluate(() => [...(CSS.highlights.get('dsh-find-all-hit') || [])].length), 0);
  await input.fill(query);
  assert.equal(await input.inputValue(), query);
}
async function searchResponse(page, dialog, query, mode, action) {
  const scope = await dialog.getByRole('checkbox', {name:'Include archived',exact:true}).isChecked()
    ? 'ordinary-including-archived' : 'ordinary-unarchived';
  const pending = page.waitForRequest(request => {
    if (!request.url().endsWith('/api/dsh-find-all/search') || request.method() !== 'POST') return false;
    try { const body = request.postDataJSON(); return body.action === 'start' && body.query === query.trim() && body.mode === mode && body.scope === scope; }
    catch { return false; }
  }, {timeout:60_000});
  await action();
  const request = await pending;
  const response = await request.response();
  assert.ok(response, 'the newly emitted request must receive a response');
  assert.equal(response.ok(), true, 'query-specific search HTTP response');
  await response.finished();
  const value = await response.json(), body = response.request().postDataJSON();
  assert.equal(value.requestId, body.requestId);
  assert.equal(value.complete, true, 'small synthetic catalog must complete in one batch');
  await eventually(() => dialog.locator('.dsh-find-all-conversations-status').innerText(), `${value.items.length} conversations`, 'query-specific response rendered');
  await eventually(() => dialog.locator('.dsh-find-all-conversations-row').count(), value.items.length, 'query-specific rows rendered');
  const expectedTitles = value.items.map(item => item.title);
  assert.ok(expectedTitles.every(title => typeof title === 'string'), 'synthetic response titles');
  await eventually(() => dialog.locator('.dsh-find-all-conversations-title').evaluateAll(elements => elements.map(element => element.getAttribute('title'))),
    titles => JSON.stringify(titles) === JSON.stringify(expectedTitles), 'rendered identities agree with this response');
  if (value.items.length) await eventually(() => dialog.locator('.dsh-find-all-conversations-match').allTextContents(),
    marks => marks.length >= value.items.length && marks.every(mark => mark.toLowerCase() === query.trim().toLowerCase()), 'rendered snippets/titles highlight this query');
  return value;
}
async function confirmCurrentRanges(page, bar, query, count, sessionId) {
  if (count > 0 && await page.locator('#dsh-find-all-root-content-panel input[type="radio"][value="whole"]').isChecked()) {
    // Selecting the last match verifies the queried document while retaining
    // the initial last-page fixture window (no offscreen history preload).
    await bar.locator('button.count').click();
    await bar.locator('input.count-input').fill(String(count));
    await bar.locator('input.count-input').press('Enter');
  }
  await eventually(() => page.evaluate(({query, sessionId}) => {
    const ranges = [...(CSS.highlights.get('dsh-find-all-hit') || [])];
    const connected = range => range.startContainer.isConnected && range.endContainer.isConnected;
    const correctOwner = range => [range.startContainer,range.endContainer].every(node =>
      node.parentElement?.closest('[data-conversation-session]')?.getAttribute('data-conversation-session') === sessionId);
    return {count:ranges.length, valid:ranges.every(range => connected(range) && range.toString() === query && correctOwner(range))};
  }, {query,sessionId}), value => value.valid && (count === 0 ? value.count === 0 : value.count > 0), 'ranges belong to current query and expected Host session');
}

export async function exerciseModernHistory(page, capture) {
  const evidence = { counts: [], navigation: [], cancellations: [], crossConversation: {}, archive: 'not-run' };
  // Preserve completed checkpoints even if a later assertion fails.
  page.findAllModernEvidence = evidence;
  const bar = page.locator('#dsh-find-all-root');
  const queryInput = bar.locator('input').first();
  const dialog = page.getByRole('dialog', { name: 'Full-text conversation search', exact: true });
  const rows = dialog.locator('.dsh-find-all-conversations-row');
  async function closeFind() {
    for (let tries = 0; tries < 3 && await bar.isVisible(); tries++) await page.keyboard.press('Escape');
    await bar.waitFor({ state: 'hidden' });
  }
  async function search(query, titleOnly = false) {
    if (!await dialog.isVisible()) {
      if (await bar.isVisible()) await closeFind();
      await page.getByRole('button', { name: 'Full-text conversation search', exact: true }).click();
    }
    await dialog.waitFor({ state: 'visible' });
    const check = dialog.getByRole('checkbox', { name: 'Titles only', exact: true });
    if (await check.isChecked() !== titleOnly) await check.click();
    const searchInput = dialog.getByRole('searchbox', { name: 'Full-text conversation search', exact: true });
    await searchInput.fill('');
    return searchResponse(page, dialog, query, titleOnly ? 'title' : 'title-body', () => searchInput.fill(query));
  }
  async function openSession(label) {
    await search(`FIND_ALL_${label} synthetic compatibility`, true);
    assert.equal(await rows.count(), 1);
    await rows.click();
    await dialog.waitFor({ state: 'hidden' });
    await page.locator(`[data-find-all-session="find-all-synthetic-${label.toLowerCase()}"]`).waitFor({ state: 'visible' });
    await page.locator('[data-chat-flow]').getByText(`FIND_ALL_${label}_USER_080 synthetic user`, { exact: true }).waitFor();
    if (await bar.isVisible()) await closeFind();
  }
  async function find(query, scope = 'whole') {
    if (!await bar.isVisible()) await page.keyboard.press('Control+f');
    await bar.waitFor({ state: 'visible' });
    await setScope(page, bar, scope === 'loaded' ? 'page' : 'whole');
    await replaceFindQuery(bar, query);
  }
  async function total(expected) {
    const value = await eventually(() => bar.locator('.count:visible').innerText(), value => completeCount(value, expected), `find total ${expected}`);
    const query = await queryInput.inputValue();
    const sessionId = await page.locator('[data-find-all-session]:visible').getAttribute('data-find-all-session');
    await confirmCurrentRanges(page, bar, query, expected, sessionId);
    return value;
  }
  async function selectedRange(query, token) {
    return page.evaluate(({query, token}) => {
      const ranges = [...(CSS.highlights.get('dsh-find-all-cur') || [])];
      if (ranges.length !== 1) return null;
      const range = ranges[0], rect = range.getBoundingClientRect();
      const flow = range.startContainer.parentElement?.closest('[data-chat-flow]');
      const row = range.startContainer.parentElement?.closest('[data-chat-node-key],[data-chat-anchor-key]');
      const text = row?.textContent || range.startContainer.parentElement?.textContent || '';
      return { exact: range.toString() === query, token: text.includes(token), inChat: !!flow,
        visible: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight,
        text: range.toString(), top: rect.top, bottom: rect.bottom };
    }, {query, token});
  }
  async function firstHit(label, kind) {
    const query = `FIND_ALL_${label}_${kind}_`, token = `${query}001`;
    await find(query); await total(80);
    await bar.locator('button.count').click();
    await bar.locator('input.count-input').fill('1');
    await bar.locator('input.count-input').press('Enter');
    await eventually(() => selectedRange(query, token), value => value?.exact && value?.token && value?.inChat && value?.visible, `earliest ${kind} exact visible range`);
    await page.waitForTimeout(1200);
    const settled = await selectedRange(query, token);
    assert.ok(settled?.exact && settled?.token && settled?.inChat && settled?.visible, 'host must not pull away after landing');
    evidence.navigation.push({label, kind, token, settled});
    await capture(`modern-${label}-${kind.toLowerCase()}-001`);
  }

  await openSession('A');
  // A body-focused shortcut must work without a preparatory header click.
  await page.evaluate(() => document.activeElement?.blur());
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
  for (const kind of ['USER', 'REPLY']) {
    await find(`FIND_ALL_A_${kind}_`, 'loaded');
    await total(25);
    evidence.counts.push({scope:'loaded', kind, count:25});
    await find(`FIND_ALL_A_${kind}_`, 'whole');
    await total(80);
    const rendered = await page.locator('[data-chat-flow]').innerText();
    assert.equal(rendered.split(`FIND_ALL_A_${kind}_`).length - 1, 25, 'whole search must not render all history');
    evidence.counts.push({scope:'whole', kind, count:80, rendered:25});
  }
  await find('FIND_ALL_A_'); await total(160);
  evidence.counts.push({scope:'whole', kind:'shared-prefix', count:160});
  await firstHit('A', 'USER');
  await closeFind();
  // Use untouched B, so assistant navigation cannot piggyback on user paging.
  await openSession('B');
  assert.equal((await page.locator('[data-chat-flow]').innerText()).split('FIND_ALL_B_REPLY_').length - 1, 25);
  await firstHit('B', 'REPLY');
  await closeFind(); await openSession('A');

  await find('FIND_ALL_A_USER_');
  await queryInput.fill('FIND_ALL_A_REPLY_080'); await total(1);
  await page.waitForTimeout(400); await total(1);
  evidence.cancellations.push('query replacement');
  await queryInput.fill('FIND_ALL_A_'); await closeFind();
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => CSS.highlights.has('dsh-find-all-cur') || CSS.highlights.has('dsh-find-all-hit')), false);
  evidence.cancellations.push('close clears ranges');
  for (const label of ['B','A']) {
    // Replace the query and navigate immediately via the real sidebar; do not
    // await the outgoing query or close it before switching the Host session.
    if (!await bar.isVisible()) await page.keyboard.press('Control+f');
    await queryInput.fill(label === 'B' ? 'FIND_ALL_A_' : 'FIND_ALL_B_');
    await page.locator(`[data-row-key="session:find-all-synthetic-${label.toLowerCase()}"]`).click();
    await page.locator(`[data-find-all-session="find-all-synthetic-${label.toLowerCase()}"]`).waitFor({state:'visible'});
    await find(`FIND_ALL_${label}_USER_`); await total(80);
    await page.waitForTimeout(300); await total(80);
    await confirmCurrentRanges(page, bar, `FIND_ALL_${label}_USER_`, 80, `find-all-synthetic-${label.toLowerCase()}`);
  }
  evidence.cancellations.push('A/B/A switch immediately after query: correct new session results');
  await closeFind();
  await search('FIND_ALL_A_USER_001');
  assert.equal(await rows.count(), 1);
  assert.ok((await rows.innerText()).includes('FIND_ALL_A_USER_001'));
  evidence.crossConversation.body = 'passed';
  await rows.click(); await dialog.waitFor({state:'hidden'});
  await bar.waitFor({state:'visible'});
  assert.equal(await queryInput.inputValue(), 'FIND_ALL_A_USER_001'); await total(1);
  evidence.crossConversation.retainedQueryHandoff = 'passed';
  await capture('modern-cross-conversation-handoff');
  await closeFind();
  await search('FIND_ALL_', true);
  assert.equal(await rows.count(), 2);
  evidence.crossConversation.title = 'passed';
  await capture('modern-cross-conversation-titles');
  await dialog.getByRole('button', {name:'Close full-text conversation search', exact:true}).click();
  // Archive the completed synthetic B through the exact host's ordinary row
  // action (ArchiveSessionRowButton), not a private RPC or persistence rewrite.
  // Official source: dsh-v0.2.1-rc.3 ui-workspace/session-actions/ArchiveSession.tsx.
  const rowB = page.locator('[data-row-key="session:find-all-synthetic-b"]');
  await rowB.waitFor({state:'visible'}); await rowB.hover();
  await rowB.getByRole('button', {name:'Archive session', exact:true}).click();
  await search('FIND_ALL_B_REPLY_001');
  assert.equal(await rows.count(), 0, 'archive excluded by default');
  const includeArchived = dialog.getByRole('checkbox', {name:'Include archived', exact:true});
  assert.equal(await includeArchived.isChecked(), false);
  await includeArchived.click();
  // Clear/requery binds this assertion to a new request in the expanded scope.
  await search('FIND_ALL_B_REPLY_001');
  assert.equal(await rows.count(), 1, 'include archived returns synthetic B');
  assert.equal(await rows.locator('.dsh-find-all-conversations-archive-label').innerText(), 'Archived');
  assert.equal(await rows.evaluate(row => row.tagName), 'DIV', 'archived result must not implicitly open');
  assert.equal(await page.locator('[data-find-all-session="find-all-synthetic-a"]').count(), 1, 'merely finding archive must preserve current conversation');
  await capture('modern-archived-result');
  await rows.getByRole('button', {name:/^Unarchive and open:/}).click();
  await dialog.waitFor({state:'hidden'});
  await page.locator('[data-find-all-session="find-all-synthetic-b"]').waitFor({state:'visible'});
  await bar.waitFor({state:'visible'});
  assert.equal(await queryInput.inputValue(), 'FIND_ALL_B_REPLY_001'); await total(1);
  evidence.archive = {excludedByDefault:'passed', explicitInclusion:'passed', noImplicitOpen:'passed', unarchiveAndOpen:'passed', retainedQuery:'passed'};
  await capture('modern-unarchived-handoff');
  await closeFind();
  return evidence;
}

export async function exerciseModernProjection(page, capture) {
  const title = 'MODERN_PROJECTION synthetic compatibility';
  const bar = page.locator('#dsh-find-all-root'), input = bar.locator('input').first();
  const dialog = page.getByRole('dialog', {name:'Full-text conversation search',exact:true});
  async function open(title) {
    for(let i=0;i<3 && await bar.isVisible();i++)await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Full-text conversation search',exact:true}).click();
    const titles = dialog.getByRole('checkbox',{name:'Titles only',exact:true});
    if(!await titles.isChecked())await titles.click();
    const searchInput = dialog.getByRole('searchbox',{name:'Full-text conversation search',exact:true});
    await searchInput.fill('');
    await searchResponse(page, dialog, title, 'title', () => searchInput.fill(title));
    assert.equal(await dialog.locator('.dsh-find-all-conversations-row').count(),1,'projection session result');
    await dialog.locator('.dsh-find-all-conversations-row').click();
    await dialog.waitFor({state:'hidden'}); await bar.waitFor({state:'visible'});
  }
  async function find(query,count,loaded=false) {
    if(!await bar.isVisible())await page.keyboard.press('Control+f');
    await setScope(page, bar, loaded ? 'page' : 'whole');
    await replaceFindQuery(bar, query);
    await eventually(()=>bar.locator('.count:visible').innerText(),value=>completeCount(value,count),`projection count ${count}`);
    await confirmCurrentRanges(page, bar, query, count, 'find-all-modern-projection');
  }
  async function jump(index) {
    await bar.locator('button.count').click(); await bar.locator('input.count-input').fill(String(index));
    await bar.locator('input.count-input').press('Enter');
  }
  await open(title);
  const secrets=page.locator('[data-chat-flow] [data-secret]');
  await eventually(()=>secrets.count(),2,'two real secret-renderer instances');
  const masked = await secrets.first().evaluate(element=>element.children[0].textContent);
  assert.ok(masked && !masked.includes('0123456789abcdef'));
  await find('src/deep/',0);
  await find('compatibility-label.txt',2);
  await jump(1);
  await eventually(()=>page.evaluate(()=>[...(CSS.highlights.get('dsh-find-all-cur')||[])].map(r=>r.toString()).join('')), 'compatibility-label.txt','real projected file-label range');
  await capture('modern-projection-file-label');
  await find(masked,2); await jump(1);
  await eventually(()=>page.evaluate(()=>[...(CSS.highlights.get('dsh-find-all-cur')||[])].length),1,'first masked range');
  // Reveal only via the official explicit user control; search itself never clicks it.
  await secrets.first().getByRole('button',{name:'Show secret',exact:true}).click();
  await eventually(()=>page.evaluate(()=>[...(CSS.highlights.get('dsh-find-all-cur')||[])].length),0,'revealed text invalidates its old masked range');
  assert.ok(completeCount(await bar.locator('.count:visible').innerText(),2),'whole-history mask count stays stable after local reveal');
  await jump(2);
  await eventually(()=>page.evaluate(()=>[...(CSS.highlights.get('dsh-find-all-cur')||[])].map(r=>r.toString()).join('')),masked,'second mask remains navigable');
  await capture('modern-projection-second-mask');
  await find('0123456789abcdef0123456789abcdef',0);
  await find('0123456789abcdef0123456789abcdef',1,true);
  await open('FIND_ALL_A synthetic compatibility'); await open(title);
  assert.equal(await secrets.getByRole('button',{name:'Show secret',exact:true}).count(),2,'remount restores default masks');
  await find(masked,2); await jump(1);
  await eventually(()=>page.evaluate(()=>[...(CSS.highlights.get('dsh-find-all-cur')||[])].map(r=>r.toString()).join('')),masked,'remounted mask navigates');
  await capture('modern-projection-remasked');
  return {fileLabels:2,defaultMasks:2,revealInvalidation:'passed',secondMaskNavigation:'passed',hiddenFragmentWhole:0,revealedFragmentLoaded:1,remount:'passed'};
}
