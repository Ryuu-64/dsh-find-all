import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installConversationSearch } from '../src/conversation-search.js';

const packageName = '@ryuu-64/dsh-find-all';
const ownDetails = { kind: 'bundle', pkg: { name: packageName, installed: true, enabled: true } };

function setup(t, slots) {
  const dom = new JSDOM('<main></main>');
  const { document } = dom.window;
  globalThis.window = dom.window;
  globalThis.document = document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.__DSH_FIND_ALL_PACKAGE__ = packageName;
  const root = createRoot(document.querySelector('main'));
  const cleanups = [];
  const components = new Map();
  const subscribers = new Set();
  let accepted = { status: 'ready', value: {} };
  const config = {
    getSnapshot: () => accepted,
    subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); },
  };
  const effect = attach => cleanups.push(attach());
  const ctx = {
    effect,
    inject(keys, attach) {
      if (keys.includes('configForms')) attach({
        configForms: { get: () => config, whileServed() {} },
        locale: { register() {} },
        effect,
      });
    },
    slots: {
      inject(name, attach) { if (slots.includes(name)) effect(attach); },
      register({ name }, Component) { components.set(name, Component); return () => components.delete(name); },
    },
  };
  const h = React.createElement;
  const ui = {
    Button: ({ size, variant, ...props }) => h('button', props),
    Input: ({ icon, ...props }) => h('input', props),
    Modal: ({ title, children }) => h('div', { role: 'dialog', 'aria-label': title }, children),
  };
  installConversationSearch(ctx, React, ui, { closeFind() {} });
  t.after(async () => {
    await act(() => root.unmount());
    for (const stop of cleanups.reverse()) stop?.();
    assert.equal(subscribers.size, 0);
    dom.window.close();
  });
  return {
    document,
    accept: snapshot => act(() => {
      accepted = snapshot;
      for (const listener of subscribers) listener();
    }),
    render: subject => act(() => root.render(
      slots.map(name => h('section', { key: name, 'data-slot': name }, h(components.get(name), { subject, wide: true })))
    )),
  };
}

test('accepted sidebar setting switches launchers without unmounting the search dialog', async t => {
  const fixture = setup(t, ['sidebar.footer.action', 'shell.overlay', 'plugins.detail.actions']);
  const { document } = fixture;
  const sidebar = () => document.querySelector('[data-slot="sidebar.footer.action"] button');
  const details = () => document.querySelector('[data-slot="plugins.detail.actions"] button');
  const dialog = () => document.querySelector('[data-slot="shell.overlay"] [role="dialog"]');
  await fixture.render(ownDetails);
  assert.ok(sidebar());
  assert.equal(details(), null);

  await fixture.accept({ status: 'loading', value: { showSidebarEntry: false } });
  assert.ok(sidebar());
  await fixture.accept({ status: 'ready', value: { showSidebarEntry: false } });
  assert.equal(sidebar(), null);
  assert.ok(details());

  await fixture.render({ ...ownDetails, pkg: { ...ownDetails.pkg, name: 'other-plugin' } });
  assert.equal(details(), null);
  await fixture.render(ownDetails);
  await act(() => details().click());
  const openDialog = dialog();
  assert.ok(openDialog);

  await fixture.accept({ status: 'ready', value: { showSidebarEntry: true } });
  assert.ok(sidebar());
  assert.equal(details(), null);
  assert.equal(dialog(), openDialog);
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 1);
});

test('the sidebar launcher remains available when the host has no detail action slot', async t => {
  const fixture = setup(t, ['sidebar.footer.action', 'shell.overlay']);
  await fixture.accept({ status: 'ready', value: { showSidebarEntry: false } });
  await fixture.render(ownDetails);
  const sidebar = fixture.document.querySelector('[data-slot="sidebar.footer.action"] button');
  assert.ok(sidebar);
  await act(() => sidebar.click());
  assert.ok(fixture.document.querySelector('[data-slot="shell.overlay"] [role="dialog"]'));
});
