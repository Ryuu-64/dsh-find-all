import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { workspaceControlsVisible } from '../scripts/compat/desktop-readiness.mjs';

// Local DOM-backed locator simulation. The same cases also run against actual
// Playwright/Chromium in desktop-readiness-fixture.mjs inside the existing Windows smoke job.
function page(html) {
  const { document } = new JSDOM(html).window;
  return { getByRole(role, { name, exact }) {
    assert.equal(role, 'button'); assert.equal(exact, true);
    return { async all() {
      return [...document.querySelectorAll('button')]
        .filter(button => (button.getAttribute('aria-label') || button.textContent) === name)
        .map(button => ({ async isVisible() { return !button.closest('[hidden]'); } }));
    } };
  } };
}
const brand = '<div data-window-drag><button aria-label="New session"><span aria-hidden="true">DeepSeek</span></button></div>';
const ordinary = '<button aria-label="New session">New Session<span aria-hidden="true">Ctrl+N</span></button>';
for (const [label, html, expected] of [
  ['two real controls', brand + ordinary, true],
  ['single control', ordinary, true],
  ['hidden shell', `<div hidden>${brand}${ordinary}</div>`, false],
  ['one visible control', `<div hidden>${brand}</div>${ordinary}`, true],
  ['lookalike controls', '<button>New Session</button><button aria-label="New session draft">Other</button>', false],
  ['loading shell', '<main>Loading workspace</main>', false],
]) test(`Desktop readiness ${label}`, async () => assert.equal(await workspaceControlsVisible(page(html)), expected));
