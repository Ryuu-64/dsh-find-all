# Changelog

## 0.1.9

- Reveal host-owned `hidden="until-found"` content before scrolling to a search match, instead of treating its layout geometry as proof that the match is visible.
- Wait for concealed matches to become visible before marking navigation as successful.

The supported host-version list is unchanged.

## 0.1.8

- Keep Ctrl+F and the header search button bound to the current main conversation across sidebar focus changes and main-view navigation.
- Add a return-to-reading-position control that restores a saved passage after navigating search results, with visible feedback when the host cannot restore it.
- Improve match navigation feedback and align the find bar with the conversation's layout and theme.
- Reveal retained, collapsed result content through the host's disclosure controls when navigating to a match; explain when it cannot be displayed.
- Exclude message-action controls from conversation search results.

The supported host-version list is unchanged. Returning to a saved passage depends on the host retaining and displaying that content; if restoration fails, the find bar remains available for retry.

## 0.1.7

- Use the host-native icon button for the conversation search entry, including theme, hover and keyboard-focus styles.
- Clarify that search covers loaded conversation content and can continue loading available earlier history; status text no longer implies complete history when the host cannot provide it.
- Retain the current match during history loading when its identity can still be verified.

The runtime code is unchanged from the accepted PR #17 merge (`f945fb9ccd581c808bc7f50128c3a7d7d2fca6da`). The existing 195 checks, release-artifact verification and RC2 Web acceptance passed; the user also confirmed their real-device test passed before this release. The exact supported host-version list is unchanged.

## 0.1.6

Fix text matching, history feedback and search state after the 0.1.5 compatibility release.

- Match phrases across inline text and syntax-highlighting spans within one text block, while keeping separate messages, block elements, `<br>` elements and excluded content apart.
- Preserve original UTF-16 offsets during case-insensitive Unicode matching, so characters such as `İ` no longer shift later highlights. Matching remains literal, without locale-specific folding or normalization.
- Report “已搜索当前可用历史” when the host stops offering earlier pages. Recheck readiness and the final results before showing that status; it does not guarantee that the host's history is complete.
- Keep the last query in the active plugin instance so reopening the bar can restore it. A valid new text selection takes priority; disabling the plugin, refreshing or restarting clears the query.
- Preserve a verifiable current match when history is prepended or the page rescans, without scrolling automatically. Restore it across replaced text nodes only when the original block text is unchanged; otherwise clamp the previous result index. A new query or conversation selects the first result.
- Add regression coverage for observer cleanup, conversation and embedded-panel isolation, cross-node text matching, history feedback, query retention and stable selection.

The supported host-version list is unchanged. This patch does not add new Web or Desktop host-matrix acceptance evidence; the 0.1.5 compatibility notes and their documented limits still apply.

## 0.1.5

Fix compatibility with newer DSH hosts while preserving the existing find controls and matching behavior.

- Use the official session header slot and session identity instead of the removed global current-session field. Ambiguous, unsupported or stale conversation targets fail closed; highlights, paging and listeners stay scoped and are cleaned up with the host lifecycle.
- Retain all previously admitted published runtimes and include the two tested 0.2 release candidates through an exact ten-version peer list. No version exemption or future-version guarantee is added.
- Document the legacy Desktop plugin-manager UI installation route, alongside the current bundled CLI route.

[Acceptance run 36998700597](https://github.com/Ryuu-64/dsh-find-all/actions/runs/36998700597) completed the plugin business checks on ten Web runtimes and three official Windows Desktop builds. The unavailable historical Desktop builds remain unverified. Host startup and shutdown errors also occurred without the plugin and remain recorded as an overall CI failure; this release does not claim to fix those host errors. See the README for the accepted version and installation boundaries.


## 0.1.4

Documentation only: no code, no bundle, no behavior changed — `lib/` is untouched, so 0.1.4
behaves exactly like 0.1.3.

0.1.3 fixed the README but sent it with a link to `CONTRIBUTING.md`, a file that same release had
just added. That file has now been deleted (see below), which would have left the published README
pointing at nothing. npm serves the README carried by the latest release, so correcting the link
on the package page means publishing again — that is the only reason this version exists.

### Removed

- **`CONTRIBUTING.md` deleted, in the repository and in the published package.** It was written as
  a chronological account of what changed rather than a document with a point of view: the
  registration-id section worked through the 0.1.0 post-mortem before saying what to do about it,
  and the structure, commands, and version-number sections restated the commit history. Nothing in
  it was needed to use the plugin.
- One item in it was not recoverable from anywhere else and is gone with the file: that a
  `failed to import loader entry <id> … loaded without registering` banner means the client
  bundle registered under the wrong id, and is not a DSH version incompatibility. It stays
  reachable in git history, and `scripts/check-client-registration.mjs` still fails the build on
  the underlying defect.

### Fixed

- `README.md` no longer links to the deleted file.

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
