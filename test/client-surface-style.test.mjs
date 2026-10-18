import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

test('the in-conversation find bar uses the compact, title-free move surface', () => {
  const styleStart = source.indexOf('" .move-header{display:flex');
  const start = source.indexOf('function buildMoveHeader(bar, controls)');
  const end = source.indexOf('function scheduleBarPosition()', start);
  assert.notEqual(styleStart, -1, 'the move header must be styled as the drag surface');
  assert.notEqual(start, -1, 'the find bar must build one focusable move header');
  assert.notEqual(end, -1, 'the move header implementation must be bounded');

  const header = source.slice(start, end);
  assert.match(header, /header\.className = "move-header"/);
  assert.match(header, /header\.tabIndex = 0/);
  assert.match(header, /header\.append\(grip, controls, actions\)/);
  assert.doesNotMatch(header, /move-title|title\.textContent/);
  assert.match(header, /event\.target\.closest\("input, button, select, textarea, a, \[contenteditable\]"\)/,
    "dragging must not intercept inputs or buttons");
  assert.match(source, /bar\.setAttribute\("aria-label", L\d*\.findTitle\)/);
  assert.match(header, /header\.setAttribute\("aria-label", L\d*\.move\)/);
  assert.match(header, /event\.target !== event\.currentTarget/,
    'keyboard movement must not consume keys from the header action buttons');
  assert.match(header, /event\.key === " "\).*event\.preventDefault\(\)/s,
    'Space on the focused move header must not scroll the conversation');
  assert.match(header, /\[reset, closeBtn\]\.forEach/,
    'reset and close must be isolated from the header drag gesture');
  assert.match(header, /event\.stopPropagation\(\)/);
  assert.match(header, /ArrowLeft: \[-32, 0\].*ArrowDown: \[0, 32\]/s);
  assert.match(header, /event\.key === "Home"/);

  const styles = source.slice(styleStart, start);
  assert.match(styles, /cursor:move/);
  assert.match(styles, /--dsw-focus-ring-width/);
  assert.doesNotMatch(source, /drag-handle|position-controls|M9 5h\.01M15 5h\.01/,
    'a separate six-dot drag control would diverge from DSH floating-panel chrome');
});
