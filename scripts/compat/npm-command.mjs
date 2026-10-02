// Windows .cmd shims cannot be spawned directly with shell:false. Use
// PowerShell's call operator with individually quoted literal arguments.
export function npmCommand(args, platform = process.platform) {
  if (platform !== 'win32') return { command: 'npm', args };
  const quote = value => `'${String(value).replaceAll("'", "''")}'`;
  return { command: 'pwsh.exe', args: ['-NoProfile', '-NonInteractive', '-Command',
    `& 'npm.cmd' ${args.map(quote).join(' ')}; exit $LASTEXITCODE`] };
}
