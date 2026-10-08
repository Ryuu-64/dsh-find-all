// Focused RC2 acceptance for this plugin's header entry, in the real host.
// No copied host styles, injected components, private stores, or model calls.
import assert from 'node:assert/strict';

async function metrics(button) {
  return button.evaluate(node => {
    const svg = node.querySelector('svg');
    if (!svg) throw new Error('header button has no SVG');
    const box = node.getBoundingClientRect(), icon = svg.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      width: box.width, height: box.height, iconWidth: icon.width, iconHeight: icon.height,
      centerDeltaX: icon.x + icon.width / 2 - box.x - box.width / 2,
      centerDeltaY: icon.y + icon.height / 2 - box.y - box.height / 2,
      color: style.color, background: style.backgroundColor, radius: style.borderRadius,
      padding: style.padding, display: style.display, align: style.alignItems, justify: style.justifyContent,
      outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor,
      focused: document.activeElement === node, focusVisible: node.matches(':focus-visible'),
    };
  });
}

function aligned(actual, native, state) {
  for (const field of ['width', 'height', 'iconWidth', 'iconHeight']) {
    assert.equal(actual[field], native[field], `${state}: ${field} matches the adjacent native action`);
  }
  assert.equal(actual.width, 28); assert.equal(actual.height, 28);
  assert.equal(actual.iconWidth, 15); assert.equal(actual.iconHeight, 15);
  assert.ok(Math.abs(actual.centerDeltaX) <= 0.5, `${state}: icon horizontally centered`);
  assert.ok(Math.abs(actual.centerDeltaY) <= 0.5, `${state}: icon vertically centered`);
  for (const field of ['color', 'background', 'radius', 'padding', 'display', 'align', 'justify']) {
    assert.equal(actual[field], native[field], `${state}: ${field} follows the native button`);
  }
}

async function keyboardFocus(page, button) {
  // Enter through real Tab navigation, rather than treating programmatic focus
  // as evidence that the host's keyboard-only focus ring is visible.
  await button.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  const result = await metrics(button);
  assert.equal(result.focused, true); assert.equal(result.focusVisible, true);
  assert.notEqual(result.outlineStyle, 'none');
  assert.ok(parseFloat(result.outlineWidth) > 0);
  assert.notEqual(result.outlineColor, 'rgba(0, 0, 0, 0)');
  return result;
}

export async function exerciseFindButtonAppearance(page, capture) {
  // exerciseHistory leaves synthetic A open after verifying real hot reload.
  const find = page.locator('button[data-find-all-session="find-all-synthetic-a"]');
  const native = page.getByRole('button', {name: 'More actions', exact: true});
  await find.waitFor({state: 'visible'}); await native.waitFor({state: 'visible'});
  assert.equal(await find.count(), 1); assert.equal(await native.count(), 1);
  const evidence = [];
  try {
    for (const theme of ['light', 'dark']) {
      // A fresh official profile defaults to System. Exercise its real theme
      // presenter via the platform preference; never rewrite theme attributes.
      await page.emulateMedia({colorScheme: theme});
      await page.waitForFunction(dark => document.body.hasAttribute('data-ds-dark-theme') === dark, theme === 'dark');
      await page.mouse.click(1, 1);
      await page.mouse.move(0, 0);
      const normal = await metrics(find), nativeNormal = await metrics(native);
      assert.equal(normal.focusVisible, false);
      aligned(normal, nativeNormal, `${theme}/normal`);
      assert.equal(await capture(`find-button-${theme}-normal`), 'captured');

      await native.hover();
      const nativeHover = await metrics(native);
      await find.hover();
      const hover = await metrics(find);
      aligned(hover, nativeHover, `${theme}/hover`);
      assert.notEqual(hover.background, normal.background, 'native hover feedback is visible');
      assert.equal(await capture(`find-button-${theme}-hover`), 'captured');

      await page.mouse.move(0, 0);
      const nativeFocus = await keyboardFocus(page, native);
      const focus = await keyboardFocus(page, find);
      aligned(focus, nativeFocus, `${theme}/keyboard-focus`);
      for (const field of ['outlineStyle', 'outlineWidth', 'outlineColor']) assert.equal(focus[field], nativeFocus[field]);
      assert.equal(await capture(`find-button-${theme}-keyboard-focus`), 'captured');

      await find.click();
      const bar = page.locator('#dsh-find-all-root');
      await bar.waitFor({state: 'visible'});
      if (await bar.locator('.scope').innerText() !== 'Loaded content') await bar.locator('.scope').click();
      await bar.locator('input').fill('FIND_ALL_A_USER_080');
      await page.waitForFunction(() => document.querySelector('#dsh-find-all-root .count')?.textContent === '1/1');
      const matches = await page.evaluate(() => [...(CSS.highlights.get('dsh-find-all-hit') || [])].map(range => ({
        text: range.toString(), session: range.startContainer.parentElement.closest('[data-conversation-session]')?.getAttribute('data-conversation-session'),
      })));
      assert.equal(matches.length, 1); assert.equal(matches[0].text, 'FIND_ALL_A_USER_080');
      assert.equal(matches[0].session, 'find-all-synthetic-a', 'click searches the button\'s own conversation');
      assert.equal(await capture(`find-button-${theme}-click-search`), 'captured');
      await page.keyboard.press('Escape');
      await bar.waitFor({state: 'hidden'});
      assert.equal(await page.evaluate(() => CSS.highlights.has('dsh-find-all-hit')), false);
      evidence.push({theme, normal, nativeNormal, hover, nativeHover, focus, nativeFocus, clickSession: matches[0].session});
    }
    assert.notEqual(evidence[0].normal.color, evidence[1].normal.color, 'the actual palette changed');
    return {status: 'passed', host: '0.2.0-rc.2', comparison: 'adjacent native More actions', themes: evidence};
  } finally { await page.emulateMedia({colorScheme: 'light'}); }
}
