# DSH 0.2.1-rc.3 compatibility review — plugin 0.1.15

## Baseline and scope

Version `0.1.15` is based on plugin `0.1.14`, commit `c0d9ae1`, not the reported
`0.1.12`. Version 0.1.14 already contains the modern user-text evaluator fix.
The search logic is unchanged; the generated bundle only updates its embedded version metadata. All four existing DSH peer requirements
add only `0.2.1-rc.3`; previous entries remain and unknown future versions remain
excluded. Neither `engines.dsh` nor a compatibility exemption is introduced.

## Official evidence and boundaries

Official host source: [`dsh-v0.2.1-rc.3`, `1f81c047`](https://github.com/deepseek-ai/deepseek-harness/tree/1f81c047fc48fa190a683e469daa699857e9afe8).

- The [compatibility evaluator](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/packages/boot/app-boot/src/plugin-compatibility.ts)
  checks all DSH peers when `engines.dsh` is absent and includes prereleases.
  A failed declaration check occurs before plugin execution; passing that check
  alone does not establish API compatibility.
- Official [plugin practices](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md)
  recommend public extension points and owned UI/theme tokens rather than
  importing Harness Client modules from ordinary JavaScript plugins. The current
  plugin still imports UI primitives, including renderers used to preserve
  search-text fidelity. This review does **not** claim to migrate that architecture
  or to make those modules a stable SDK.
- The rc.2 and rc.3 source blobs for the used Markdown/tool renderers and
  Modal/Button/Input/Checkbox/clipboard exports are unchanged. Dropping them
  without an equivalent projection contract would break whole-history search,
  so this compatibility fix preserves them and tests the exact host instead.
- Vendor pins in `scripts/compat/vendor-versions.json` come from each official
  tag's `vendor/*/package.json`; no drifting newer host dependencies or host
  source modifications are used for acceptance.

### Complete source-tree comparison (rc.2 → rc.3)

Both recursive Git trees were complete (`truncated: false`); comparison used
individual blob SHAs rather than the limited GitHub compare response.

| Dependency surface | Observed source changes |
| --- | --- |
| session-controller | Package version and one comment in `sessions/service.ts` |
| ui-chat | Package version only |
| ui-conversation | More views menu, draft initialization, submit statistics; userText contract/registry/document/component unchanged |
| ui-primitives | Menu optional parameters, Tooltip positioning, new icons; the renderers/controls used here remain unchanged |

These observations reduce the expected regression surface but do not replace
browser acceptance. Menu/Tooltip placement and keyboard/resize behavior remain
explicitly unverified in this run.

## Reproduction

```sh
npm ci --ignore-scripts --legacy-peer-deps
npm run check
npm run verify:release
mkdir -p evidence/artifact
npm pack --ignore-scripts --pack-destination evidence/artifact
FIND_ALL_FULL_ACCEPTANCE=1 node scripts/compat/web-smoke.mjs 0.2.1-rc.3 \
  evidence/artifact/ryuu-64-dsh-find-all-0.1.15.tgz evidence/0.2.1-rc.3
```

The development dependency install flag is not used to bypass the host's plugin
gate. Runtime installation is strict and the CLI installs the candidate normally.
Use only synthetic sessions and isolated profiles, without model credentials.
`FIND_ALL_CHROMIUM_PATH` optionally selects an installed Chromium executable.
`FIND_ALL_REUSE_RUN` may point to the runner's own isolated acceptance directory
for diagnostic retries; every installed DSH/vendor version is still verified.
Only dependency installation is reused: each retry gets a fresh isolated home and workspace. This is recorded separately from a fresh dependency download.

## Results on the dot cloud computer (2026-10-27)

- Baseline `npm run check`: 196 passed. Candidate: 198 passed, including exact
  version/lock checks. `verify:release` passed. Production client SHA-256 remains
  `a15289613f673c5586117d50e6d88c0ee797087fe5352011f98a74740a96e623`.
- Official `0.2.1-rc.3` installed with strict dependency checks. All installed
  DSH and vendor versions were verified. The installed official evaluator rejects
  original `0.1.14` on four peers, accepts this candidate without exemptions, and
  rejects unknown `0.2.1-rc.4`.
- The same candidate installed through normal official `plugin add`. Its real
  HTTP route rejects unauthenticated requests (401); earliest A user/B assistant
  body queries each return one session, title query two, absent query zero. All
  finish with zero failed/skipped sessions, exact snippet offsets, and working
  cancellation. No optional SQLite full-text index was enabled.

### Actual native-browser acceptance

The exact host ran in dot's native Terminal, with a runtime in the shared
workspace and a newly isolated HOME/XDG/DSH profile. The existing dot Chromium
opened the official fresh local-login URL. All sessions were synthetic; no
model account, real credentials, or external model calls were used.

Passed through actual UI actions and read-only DOM observations:

- A's loaded-content search finds 25 user and 25 assistant messages; whole-history
  search finds 80 each and 160 combined while only 25 turns remain rendered.
- First-user A001 and independently first-assistant B001 navigation load earlier
  real Chat rows. Genuine screenshots show exact orange query highlights, the
  correct 001 text and 1/80 after settling. The browser's read-only inspection
  wrapper does not expose `CSS.highlights`; screenshot/visible DOM evidence is
  used here, not a claimed automated CSS Range assertion.
- Ctrl+F, rapid query replacement, Close, and A/B/A session switching produce
  the current session's correct results without duplicate find bars.
- Cross-conversation body and title search, retained-query handoff, archive
  exclusion by default, explicit Include archived, and Unarchive and open pass.
  Merely displaying an archived result does not restore/open it.
- Modern file labels match twice while their undisplayed raw path matches zero.
  Two default-masked synthetic secrets match; manually revealing the first
  clears its old highlight while whole-history retains two default-mask results.
  The second mask remains navigable. A revealed raw fragment matches zero in
  whole-history and one in loaded-content mode; remounting restores masking.
- Two native plugin-manager disable/re-enable cycles remove/reinstall the search
  entry (0 → 1) without a page refresh. Ctrl+F subsequently opens one working bar.
- Light and dark-theme find/highlight smoke checks pass; System theme is restored.

The captured warning/error review contained 269 entries, all attributed to the
browser extension's content script (`Error sending browser metadata to extension`).
No other source appeared in that review. This is not a claim of a completely
empty browser console or a fix to the extension.

### Why the first attempt could not reach the browser

The command runner and native desktop do not share the same temporary directory
or localhost process environment. Launching a new Chromium subprocess inside the
command runner failed at Unix sockets; a normal escalation attempt failed during
environment initialization. The existing native browser could not reach the
runner-local server. These failures did not establish a plugin failure.

The previously successful supported method resolved the issue: put the exact
runtime in the shared workspace, launch only the already-authorized local DSH
host through native Terminal, and use the existing dot browser. No security
setting was changed, no denied file was accessed, and no blocked Chromium launch
or escalation was repeated. Do not reuse old authentication URLs or profiles.

### Scope / evidence matrix

| Plugin / host | Version gate | This run's evidence |
| --- | --- | --- |
| Released 0.1.14 / DSH 0.2.1-rc.3 | Rejected on four peers | Official evaluator reproduced |
| 0.1.15 (same verified runtime code) / DSH 0.2.1-rc.3 Web on dot Linux | Accepted without exemption | 0.1.15 normal installation/HTTP passed; full native UI passed on the patched 0.1.14 candidate with equivalent search logic |
| Candidate / rc.2 and previous declared hosts | Exact declarations preserved | Not rerun; historical records remain separate |
| Candidate / unknown future releases | Rejected | rc.4 explicitly checked; no future compatibility claim |
| Packaged Electron / other operating systems | Not established here | Not tested by this Linux Web run |

A full responsive/resize/Tooltip matrix, third-party renderer combinations, and
all historical host versions remain unverified. The Playwright browser script
was updated from observed modern UI, but was not itself run end-to-end: the
browser acceptance above used supported native browser control.

The native acceptance was performed with the local patched 0.1.14 candidate;
0.1.15 carries identical search logic and peer declarations, with embedded version values and release
metadata/documentation updated. A user still on 0.1.12 needs the complete modern
baseline in 0.1.15, not only a peer-range edit. No account/security settings are
changed by this compatibility fix.

Use `FIND_ALL_HTTP_ONLY=1` for the separately named HTTP layer. For the native
browser method, use `scripts/compat/native-host.sh` with an already prepared
exact runtime under the shared workspace, then open the fresh official local
URL in dot's existing browser. Local authentication output must never be included
in commits or evidence delivery.
