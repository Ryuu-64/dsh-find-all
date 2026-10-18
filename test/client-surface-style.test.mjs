import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

test('current-conversation find delegates its surface and movement to the public sidebar', () => {
  assert.match(source, /sidebarRightTabs\.register/);
  assert.match(source, /keepMounted: true/);
  assert.match(source, /sidebar\.right\.pane\.tab/);
  assert.match(source, /props\.useTabInfo\(\)/);
  assert.match(source, /state\.container\.appendChild\(bar\)/);
  assert.doesNotMatch(source, /function buildMoveHeader|\.move-header\{|drag-handle|position-controls/);
  assert.doesNotMatch(source, /require\(["']@deepseek-ai\/dsh-client-ui-dockkit/);
});
