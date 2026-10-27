import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import semver from 'semver';
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const versions = ['0.1.5-rc.2','0.1.5-rc.3','0.1.6-alpha.1','0.1.6-alpha.2','0.1.7-alpha.1','0.1.7-alpha.2','0.1.7-rc.1','0.1.7-rc.2','0.2.0-rc.1','0.2.0-rc.2','0.2.1-rc.2','0.2.1-rc.3'];
// Official rc.3 app-boot/plugin-compatibility.ts includes prereleases. These
// manifest assertions are a declaration check, not real-host API acceptance.
test('all four DSH peers admit only the explicitly reviewed host versions', () => {
  assert.equal(Object.keys(manifest.peerDependencies).length, 4);
  assert.equal(manifest.engines?.dsh, undefined, 'do not supersede the dependency gate');
  for (const range of Object.values(manifest.peerDependencies)) {
    assert.deepEqual(range.split(' || '), versions);
    for (const version of versions) assert.ok(semver.satisfies(version, range, { includePrerelease: true }), version);
    for (const version of ['0.2.1-rc.1','0.2.1-rc.4','0.2.1','0.2.2-alpha.1','0.3.0']) {
      assert.equal(semver.satisfies(version, range, { includePrerelease: true }), false, version);
    }
  }
});
test('lock root and package declare identical host requirements', () => {
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)));
  assert.deepEqual(lock.packages[''].peerDependencies, manifest.peerDependencies);
});
