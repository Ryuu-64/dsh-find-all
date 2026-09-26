# Changelog

## 0.1.3

Documentation only: no code, no bundle, no behavior changed. Published so the README on the npm
package page is the user-facing one — npm serves the README carried by the latest release.

### Changed

- **`README.md` is now written for users.** It had been carrying maintainer material: internal
  session-service calls, the tarball install for when publishing is blocked, the 0.1.0
  registration post-mortem, the derived-literal warning for future forkers, and the test
  commands. A user opening the page had to work out which parts applied to them. The README now
  answers what the plugin does, how to install it, the keyboard reference, known limitations, and
  how to uninstall.

### Added

- **`CONTRIBUTING.md`** takes that material rather than dropping it, plus a note on why release
  coordinates cannot be reused (the reason 0.1.1 became 0.1.2). It is not in `package.json`'s
  `files` whitelist, so npm users do not receive it.

### Fixed

- `scripts/install-local.mjs` told the operator to move to the registry "once 0.1.1 is published",
  a version that can never exist. It now refers to the installed version generically.

## 0.1.2

Nothing about the code changed — this release exists only because **0.1.1 can never be
published**. The publish that produced `+ @ryuu-64/dsh-find-all@0.1.1` left the version in npm's
staging area rather than on the registry, and the registry refuses to reuse the coordinate:

```text
409 Cannot publish over previously staged version "0.1.1"
409 Cannot stage previously published version "0.1.1"
```

That is expected, not a bug: registry data is immutable, and *"if you've ever published a package
called bob at version 1.1.0, no other package can ever be published with that name at that
version. This is true even if that package is unpublished"* ([npm Unpublish
Policy](https://docs.npmjs.com/policies/unpublish)). The 0.1.1 tarball never became reachable
(`/0.1.1` → 404, its tarball → 404), so the fix is republished unchanged as 0.1.2.

The 0.1.1 section below still describes this release's content: same bundle, same fix, byte for
byte.

## 0.1.1

### Fixed

- **The client bundle now registers under the package name.** `lib/client.js` called
  `window.__ModuleLoader__.load({ id: "dsh-find-all", ... })` — the unscoped name — while the
  package is `@ryuu-64/dsh-find-all`. The host composes the boot-graph row id from the package
  name (`ClientModuleRegistry.reconcilePackage`), and `ClientModuleSystem.arrive()` rejects the
  row when the executed bundle did not register a factory under exactly that key, so the plugin
  loaded and then failed with:

  ```text
  failed to import loader entry <id>: client-modules: bundle /plugins/??...&rev=... 
  loaded without registering "@ryuu-64/dsh-find-all" via __ModuleLoader__.load
  ```

  The GUI surfaced this as "Failed to load plugins / 部分插件加载失败", which reads like a DSH
  version incompatibility; it was not.

  Introduced by the 0.1.0 fork, which renamed every other `dsh-find-bar` identifier to
  `dsh-find-all` but left the registration id unscoped. `id` is now `"@ryuu-64/dsh-find-all"`.

### Added

- `scripts/check-client-registration.mjs` (wired into `npm run check`): reads the expected id from
  `package.json` and fails with a `file:line` diagnostic when the bundle registers anything else,
  so the drift cannot come back unnoticed. It takes an optional package root, so it can inspect a
  registry tarball or an installed profile instead of only this checkout.
- `npm run verify:release`: packs the artifact `npm publish` would upload and checks the id inside
  that tarball. This is the check that would have caught 0.1.0 before it reached the registry.
- `npm run deploy:profile`: installs a published release into a DSH profile and refuses to finish
  until the installed bundle is byte-identical to the registry artifact and registers correctly.
  Rolls the profile manifests back on any failure.
- Tests for the registration check itself (`test/client-registration-check.test.mjs`): they run it
  against a mutated copy, which is how the check was caught silently falling back to the checkout
  and reporting the defective registry 0.1.0 as clean.
- `test/bundle-registration.test.mjs`: the invariant as a test, with the expected value read
  from `package.json` rather than hardcoded.
- README section on the "Failed to load plugins" symptom, why it is not a DSH version problem, and
  the fork re-scope hazard behind it.

## 0.1.0

Initial release: a Ctrl+F find bar that searches the whole conversation, forked from
[`secyborg/dsh-find-bar`](https://github.com/secyborg/dsh-find-bar) (MIT).
