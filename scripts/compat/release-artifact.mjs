// Release-QA-only adapter for the existing workflow's historical 0.1.4 filename.
// Resolve the adjacent canonical 0.1.6 file explicitly; never rename it or report
// it as 0.1.4. Only the independently reviewed bytes may enter host acceptance.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const RELEASE = Object.freeze({
  name: '@ryuu-64/dsh-find-all',
  version: '0.1.6',
  filename: 'ryuu-64-dsh-find-all-0.1.6.tgz',
  sha256: 'ed3161e10c849ce4c817a437a9104284c01e6063041822ec43d807dbb6f94577',
});
const LEGACY_FILENAME = 'ryuu-64-dsh-find-all-0.1.4.tgz';

export function resolveReleaseArtifact(requestedPath) {
  assert.ok(requestedPath, 'supply a candidate tgz path');
  const requested = path.resolve(requestedPath);
  const requestedFilename = path.basename(requested);
  assert.ok([RELEASE.filename, LEGACY_FILENAME].includes(requestedFilename), 'unexpected candidate filename');
  const resolved = path.join(path.dirname(requested), RELEASE.filename);
  assert.ok(fs.statSync(resolved).isFile(), 'approved 0.1.6 candidate must exist beside the requested workflow path');
  const sha256 = createHash('sha256').update(fs.readFileSync(resolved)).digest('hex');
  assert.equal(sha256, RELEASE.sha256, 'candidate must exactly match the independently approved 0.1.6 archive');
  const manifest = JSON.parse(execFileSync('tar', ['-xOf', resolved, 'package/package.json'], { encoding: 'utf8' }));
  assert.equal(manifest.name, RELEASE.name, 'candidate package identity');
  assert.equal(manifest.version, RELEASE.version, 'candidate package version');
  return Object.freeze({
    name: manifest.name, version: manifest.version, filename: RELEASE.filename,
    path: resolved, sha256, requestedPath: requested,
    legacyWorkflowPathResolved: requestedFilename === LEGACY_FILENAME,
  });
}
