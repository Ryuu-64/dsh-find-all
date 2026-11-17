import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers/search-ui.mjs';

test('search options open this package through the optional DSH plugin navigator', async () => {
  const ui = setup();
  try {
    const view = await ui.mount('find-all-test');
    const opened = [];
    ui.ctx.get = key => key === 'pluginNavigation'
      ? { openBundle: packageName => opened.push(packageName) }
      : undefined;
    ui.open(view.anchor);
    ui.w.document.querySelector('.content-filter').click();
    const control = ui.w.document.querySelector('.update-command button');
    assert.equal(control.hidden, false);
    assert.deepEqual(opened, []);
    control.click();
    assert.deepEqual(opened, ['@ryuu-64/dsh-find-all']);
  } finally {
    await ui.finish();
  }
});

test('older hosts still show update instructions without exposing a nonfunctional action', async () => {
  const ui = setup();
  try {
    const view = await ui.mount('find-all-test');
    ui.open(view.anchor);
    ui.w.document.querySelector('.content-filter').click();
    const section = ui.w.document.querySelector('.update-command');
    assert.equal(section.querySelector('button').hidden, true);
    assert.equal(section.querySelector('a[href]').hash, '#%E6%9B%B4%E6%96%B0');
  } finally {
    await ui.finish();
  }
});
