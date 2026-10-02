import assert from 'node:assert/strict';
import { installThroughDesktopUi } from './desktop-plugin-install.mjs';

export const installingWizardFixture = '<div data-install-phase="running"><h2>Installing plugin</h2><p role="status">Running package manager</p></div>';

// Static fixture of both reviewed legacy tags' actual accessibility names and
// data-install-phase state machine. It is not a claim of an installed host run.
export async function verifyDesktopPluginInstallFixture(page) {
  const artifact = 'C:\\synthetic path\\candidate.tgz';
  for (const phase of ['done', 'failed']) {
    await page.setContent(`<nav aria-label="Global panels"><button>Plugins</button></nav>
      <section data-plugin-panel hidden><button>Add plugin</button></section>
      <div role="dialog" hidden><input aria-label="Package name or address"><button>Install</button></div>`);
    await page.evaluate(({ phase, wizardHtml }) => {
      const panel = document.querySelector('[data-plugin-panel]');
      const dialog = document.querySelector('[role=dialog]');
      document.querySelector('nav button').onclick = () => { panel.hidden = false; };
      panel.querySelector('button').onclick = () => { dialog.hidden = false; };
      dialog.querySelector('button').onclick = () => {
        document.body.dataset.receivedSpec = dialog.querySelector('input').value;
        dialog.innerHTML = wizardHtml;
        setTimeout(() => {
          const progress = dialog.querySelector('[data-install-phase]');
          progress.setAttribute('data-install-phase', phase);
          progress.querySelector('[role=status]').textContent = phase === 'done' ? 'Plugin installed' : 'Installation failed';
          if (phase === 'done') {
            const enable = document.createElement('button');
            enable.textContent = 'Enable now';
            enable.onclick = () => {
              dialog.hidden = true;
              const style = document.createElement('style');
              style.dataset.pluginCss = 'dsh-find-all/bar.css';
              document.head.append(style);
            };
            progress.append(enable);
          }
        }, 250);
      };
    }, { phase, wizardHtml: installingWizardFixture });
    if (phase === 'done') assert.equal((await installThroughDesktopUi(page, artifact, { timeout: 3000 })).status, 'passed');
    else await assert.rejects(installThroughDesktopUi(page, artifact, { timeout: 3000 }), /did not succeed: failed/);
    assert.equal(await page.locator('body').getAttribute('data-received-spec'), artifact);
  }
  return { status: 'passed', cases: 2, coverage: 'legacy official UI success and refused installation; fixture only' };
}
