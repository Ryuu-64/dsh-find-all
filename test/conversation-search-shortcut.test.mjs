import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { installConversationSearch } from '../src/conversation-search.js';

test('full-text search exposes an unbound shortcut that opens the search and is removed on unload', t => {
  const { window } = new JSDOM();
  globalThis.window = window;
  globalThis.document = window.document;
  t.after(() => {
    window.close();
    delete globalThis.window;
    delete globalThis.document;
  });

  const commands = new Map();
  const cleanups = [];
  const effect = callback => cleanups.push(callback());
  const shortcuts = {
    register(command) {
      commands.set(command.id, command);
      return () => commands.delete(command.id);
    },
  };
  const ctx = {
    inject(services, callback) {
      if (services.includes('shortcuts')) callback({ shortcuts, effect });
    },
    slots: { inject() {} },
    effect,
  };
  const closeFind = t.mock.fn();
  const search = installConversationSearch(ctx, {}, { Modal() {}, Input() {} }, { closeFind });
  const command = commands.get('dsh-find-all.search-conversations');
  assert.ok(command);
  assert.deepEqual(command.defaults, {});
  assert.equal(search.isOpen(), false);
  assert.equal(command.resolve({ modal: 'another-dialog' }).status, 'pass');

  const action = command.resolve({ modal: null });
  assert.equal(action.status, 'handled');
  action.run();
  assert.equal(search.isOpen(), true);
  assert.equal(closeFind.mock.callCount(), 1);
  assert.equal(command.resolve({ modal: null }).status, 'pass');

  for (const cleanup of cleanups.reverse()) cleanup();
  assert.equal(commands.size, 0);
});
