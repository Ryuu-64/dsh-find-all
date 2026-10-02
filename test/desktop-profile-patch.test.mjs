import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setFixturePatch } from '../scripts/compat/synthetic-history.mjs';

test('Desktop lifecycle changes only its own temporary profile; Web default remains intact', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'find-all-profile-'));
  try {
    for (const profile of ['web', 'desktop']) fs.mkdirSync(path.join(home, '.dsh', 'profiles', profile), { recursive: true });
    const file = profile => path.join(home, '.dsh', 'profiles', profile, 'cordis.patch.yml');
    setFixturePatch(home, '/synthetic/web.sqlite');
    const web = fs.readFileSync(file('web'), 'utf8');
    setFixturePatch(home, '/synthetic/desktop.sqlite', true, 'desktop');
    assert.equal(JSON.parse(fs.readFileSync(file('desktop'))).find(row => row.id === 'find-all').disabled, true);
    setFixturePatch(home, '/synthetic/desktop.sqlite', false, 'desktop');
    assert.equal(JSON.parse(fs.readFileSync(file('desktop'))).find(row => row.id === 'find-all').disabled, false);
    assert.equal(fs.readFileSync(file('web'), 'utf8'), web);
    assert.throws(() => setFixturePatch(home, '/synthetic/query.sqlite', false, '../other'), /owned Web\/Desktop/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
