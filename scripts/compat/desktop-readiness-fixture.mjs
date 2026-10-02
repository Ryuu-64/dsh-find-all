import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { verifyDesktopPluginInstallFixture } from './desktop-plugin-install-fixture.mjs';
import { workspaceControlsVisible } from './desktop-readiness.mjs';

// Static reconstruction of official dsh-v0.2.0-rc.2 SidebarRoot.tsx 216–277.
// No private CSS names: only its actual roles, aria labels, shortcut and text.
const brand = '<div data-window-drag><button type="button" aria-label="New session" aria-keyshortcuts="Control+N"><span aria-hidden="true">DeepSeek</span></button></div>';
const ordinary = '<button type="button" aria-label="New session" aria-keyshortcuts="Control+N"><span>New Session</span><span aria-hidden="true">Ctrl+N</span></button>';
export async function verifyDesktopReadinessFixture() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(brand + ordinary);
    await assert.rejects(page.getByRole('button', { name: 'New session', exact: true }).isVisible(), /strict mode violation/);
    assert.equal(await page.getByRole('button', { name: 'New Session', exact: true }).count(), 0);
    assert.equal(await workspaceControlsVisible(page), true, 'both actual Windows controls');
    await page.setContent(ordinary);
    assert.equal(await workspaceControlsVisible(page), true, 'single ordinary entry');
    await page.setContent(`<div hidden>${brand}${ordinary}</div>`);
    assert.equal(await workspaceControlsVisible(page), false, 'hidden shell is not ready');
    await page.setContent(`<div hidden>${brand}</div>${ordinary}`);
    assert.equal(await workspaceControlsVisible(page), true, 'one visible entry');
    await page.setContent('<button>New Session</button><button aria-label="New session draft">Other</button>');
    assert.equal(await workspaceControlsVisible(page), false, 'visible lookalikes are not official controls');
    await page.setContent('<main>Loading workspace</main>');
    assert.equal(await workspaceControlsVisible(page), false, 'no shell');
    await verifyDesktopPluginInstallFixture(page);
    console.log('Desktop readiness: old failures reproduced; six real DOM visibility cases passed');
  } finally { await browser.close(); }
  return { status: 'passed', cases: 6, oldCaseAndStrictFailuresReproduced: true };
}
