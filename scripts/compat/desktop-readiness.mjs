// Official rc2 SidebarRoot.tsx 244–276: the expanded brand and ordinary
// button share session.new.label. Locale text is "New session"; visible
// session.new text is "New Session". Readiness must tolerate both controls.
export async function workspaceControlsVisible(page) {
  const controls = await page.getByRole('button', { name: 'New session', exact: true }).all();
  return (await Promise.all(controls.map(control => control.isVisible()))).some(Boolean);
}
