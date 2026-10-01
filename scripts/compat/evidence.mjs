import fs from 'node:fs';

export function createRedactor(secrets = new Set()) {
  return value => {
    let text = String(value);
    for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]');
    text = text.replace(/https?:\/\/[^\s<>"']+/g, raw => {
      try {
        const url = new URL(raw);
        url.username = ''; url.password = ''; url.search = ''; url.hash = '';
        return url.href;
      } catch { return '[redacted URL]'; }
    });
    return text.replace(/(^|\n)(\s*(?:authorization|cookie|set-cookie|x-api-key|password|secret)\s*[:=])[^\r\n]*/gi, '$1$2 [redacted]');
  };
}

export async function captureSafePage(page, base, secrets, redact) {
  for (const cookie of await page.context().cookies()) secrets.add(cookie.value);
  const text = await page.locator('body').innerText();
  const safe = redact(text);
  fs.writeFileSync(`${base}.txt`, safe);
  const filledPassword = await page.locator('input[type="password"]').evaluateAll(inputs => inputs.some(input => input.value.length > 0));
  if (safe !== text || filledPassword) return 'omitted: credential-like UI text';
  await page.screenshot({ path: `${base}.png` });
  return 'captured';
}
