import assert from 'node:assert/strict';

// Official dsh-v0.2.0-rc.1 and dsh-v0.1.7-rc.2:
// packages/client/ui-plugin-manager/src/client/{PluginManagerPage,manager-store,locales}.ts[x]
// The old CLI deliberately rejects Desktop. Its UI accepts an absolute local
// tarball and calls the same official package/compatibility manager.
export function disableFixtureInstallScripts(workspace) {
  assert.doesNotMatch(workspace, /^ignoreScripts\s*:/m, 'unexpected existing script policy');
  return `${workspace}${workspace.endsWith('\n') ? '' : '\n'}ignoreScripts: true\n`;
}

export function requireInstallPhase(phase, approvalVisible) {
  assert.equal(approvalVisible, false, 'installation requested unapproved build scripts');
  assert.ok(['starting', 'running', 'applying', 'done'].includes(phase), `official installer did not succeed: ${phase}`);
  return phase === 'done';
}

export async function installThroughDesktopUi(page, artifact, { timeout = 180_000 } = {}) {
  await page.getByRole('navigation', { name: 'Global panels', exact: true })
    .getByRole('button', { name: 'Plugins', exact: true }).click();
  await page.locator('[data-plugin-panel]').getByRole('button', { name: 'Add plugin', exact: true }).click();
  const dialog = page.getByRole('dialog');
  assert.equal(await dialog.count(), 1, 'unexpected competing installation dialog');
  await dialog.getByRole('textbox', { name: 'Package name or address', exact: true }).fill(artifact);
  await dialog.getByRole('button', { name: 'Install', exact: true }).click();
  const progress = page.locator('[data-install-phase]');
  await progress.waitFor({ state: 'visible', timeout });
  const deadline = Date.now() + timeout;
  while (true) {
    const phase = await progress.getAttribute('data-install-phase');
    const approval = await page.locator('[data-install-approval]').isVisible();
    if (requireInstallPhase(phase, approval)) break;
    assert.ok(Date.now() < deadline, 'official Desktop plugin installation timed out');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  // No retries, script approvals or version exemptions are clicked. A failed
  // official compatibility check remains a failed test.
  await dialog.getByRole('button', { name: 'Enable now', exact: true }).click();
  await dialog.waitFor({ state: 'hidden', timeout });
  await page.locator('style[data-plugin-css="dsh-find-all/bar.css"]').waitFor({ state: 'attached', timeout });
  return { status: 'passed', method: 'official-plugin-manager-ui', buildScripts: 'disabled', versionExemptions: 'none' };
}
