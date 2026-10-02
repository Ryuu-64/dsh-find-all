import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { disableFixtureInstallScripts, requireInstallPhase } from '../scripts/compat/desktop-plugin-install.mjs';
import { installingWizardFixture } from '../scripts/compat/desktop-plugin-install-fixture.mjs';

test('official wizard fixture contains heading and status inside the progress container', () => {
  // Structural regression only; layout visibility is checked by real Chromium
  // in the existing Windows readiness fixture, not simulated by jsdom.
  const document = new JSDOM(installingWizardFixture).window.document;
  const progress = document.querySelector('[data-install-phase]');
  assert.ok(progress.querySelector('h2').textContent.trim());
  assert.ok(progress.querySelector('[role="status"]').textContent.trim());
  assert.equal(progress.querySelector('[hidden]'), null);
});

test('legacy Desktop install preserves the official workspace byte for byte and disables scripts', () => {
  const source = 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\noverrides:\n  core: file:./core.tgz\nallowBuilds:\n  node-pty: true\n';
  assert.equal(disableFixtureInstallScripts(source), source + 'ignoreScripts: true\n');
  assert.equal(disableFixtureInstallScripts(source.trimEnd()), source + 'ignoreScripts: true\n');
  assert.throws(() => disableFixtureInstallScripts(source + 'ignoreScripts: false\n'), /existing script policy/);
});
for (const phase of ['starting', 'running', 'applying', 'done']) {
  test(`official Desktop UI phase ${phase}`, () => assert.equal(requireInstallPhase(phase, false), phase === 'done'));
}
for (const phase of ['failed', 'unknown', 'unconfirmed', 'cancelling', 'idle', null]) {
  test(`official Desktop UI refuses ${phase}`, () => assert.throws(() => requireInstallPhase(phase, false), /did not succeed/));
}
test('build approval never becomes acceptance, even with a done phase', () => {
  assert.throws(() => requireInstallPhase('done', true), /unapproved build scripts/);
});
