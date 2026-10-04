import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE, resolveReleaseArtifact } from '../scripts/compat/release-artifact.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
let temp;
before(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'find-all-release-path-'));
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--ignore-scripts', '--silent', '--pack-destination', temp], {
    cwd: root, shell: process.platform === 'win32', stdio: 'pipe',
  });
});
after(() => fs.rmSync(temp, { recursive: true, force: true }));

test('canonical path verifies the exact 0.1.6 package bytes and manifest', () => {
  const result = resolveReleaseArtifact(path.join(temp, RELEASE.filename));
  assert.equal(result.version, '0.1.6');
  assert.equal(result.sha256, RELEASE.sha256);
  assert.equal(result.legacyWorkflowPathResolved, false);
});

test('legacy workflow filename resolves explicitly without renaming or misreporting the package', () => {
  const legacy = path.join(temp, 'ryuu-64-dsh-find-all-0.1.4.tgz');
  const result = resolveReleaseArtifact(legacy);
  assert.equal(result.requestedPath, legacy);
  assert.equal(result.path, path.join(temp, RELEASE.filename));
  assert.equal(result.filename, RELEASE.filename);
  assert.equal(result.version, '0.1.6');
  assert.equal(result.legacyWorkflowPathResolved, true);
  assert.equal(fs.existsSync(legacy), false);
});

test('missing canonical 0.1.6 package never falls back to an old package', () => {
  const missing = fs.mkdtempSync(path.join(temp, 'missing-'));
  const legacy = path.join(missing, 'ryuu-64-dsh-find-all-0.1.4.tgz');
  fs.writeFileSync(legacy, 'not the approved package');
  assert.throws(() => resolveReleaseArtifact(legacy), /ENOENT/);
});

test('changed bytes and unexpected candidate filenames are rejected', () => {
  const changed = fs.mkdtempSync(path.join(temp, 'changed-'));
  fs.writeFileSync(path.join(changed, RELEASE.filename), 'changed bytes');
  assert.throws(() => resolveReleaseArtifact(path.join(changed, RELEASE.filename)), /independently approved/);
  assert.throws(() => resolveReleaseArtifact(path.join(temp, 'other-package.tgz')), /unexpected candidate filename/);
});
