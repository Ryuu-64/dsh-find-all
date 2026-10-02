# Issue #1: compatibility acceptance

This implementation follows the approved [Issue #1 plan](https://github.com/Ryuu-64/dsh-find-all/issues/1#issuecomment-5933617888), with the accepted release scope and unverified Desktop limits recorded in [PR #9](https://github.com/Ryuu-64/dsh-find-all/pull/9). This does not promise compatibility with untested or future hosts. Issues #2–#8 are outside this change.

## Contract research

The adapter uses a `conversation.session.header.utilities` list entry. Its `sessionId` comes from the session standard props; it never consults the old global `sessions.list.current` field. A mounted button identifies one view instance, not just one session. Keyboard focus or a click inside a visible view selects that instance. An ambiguous multi-view selection fails closed with a prompt to select a conversation. Focus in the find bar preserves the selected instance. On the first shortcut, neutral body focus may discover one registered view only when all visible registered instances and known conversation content/scroll/flow containers identify that same single instance. Visible unsupported or embedded views also make discovery ambiguous; the main panel and its own content are deduplicated. Explicit rejection, ambiguity, or loss of an earlier selection blocks that discovery; passive checks never select a replacement.

Official release-tag sources inspected:

- [`0.1.5-rc.2` slot contract](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/packages/client/ui-conversation/src/client/contract/slots.ts), [session standard props](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/packages/client/ui-session/src/client/index.ts), and [header utility registration / `ctx.effect` example](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/packages/session-query/session-log-export/src/client/index.ts)
- [`0.1.5-rc.2` root](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx) and [`0.1.5-rc.3` root](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.3/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx): the header and one conversation scrollport share the `data-phase` root
- [`0.1.6-alpha.2` main panel](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.2/packages/client/ui-conversation/src/client/skeleton/ConversationMainPanel.tsx) and [content](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.2/packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx): split components retain that root/scrollport structure
- [`0.1.7-rc.2` content](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.2/packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx), [`0.2.0-rc.1` content](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx), and [`0.2.0-rc.2` content](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx): explicit content session identity is additionally checked
- [`0.2.0-rc.2` slot registry](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/client/ui-renderer/src/client/registry.ts): slot injection and registration are context-owned effects

The official [startup fixture](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/apps/web/tests/startup-auto-selection.e2e.ts) explicitly distinguishes the resident conversation root from the composer's unrelated `data-phase`. Routing skips that editor attribute. Initial focus in an unbound Hero/settling composer before any visible registered session exists keeps the never-selected state; a rejected active conversation or lost selection still cannot trigger discovery of another view.

DOM attributes are implementation details, not a promised future host API. `resolveScope` is their single adapter boundary. It requires an active, connected, visible panel, exactly one registered session anchor, one scrollport, and one visible `data-chat-flow`. If explicit host session metadata exists, it must match. Search and mutation observation stay inside that flow. A missing/ambiguous/hidden/replaced flow yields no results or paging. There is no `document.body` or `window.find` fallback.

`ctx.effect` owns global key/focus/pointer listeners and teardown. React effect cleanup removes each session anchor. Close/dispose cancels debounce, paging-start, paging-settle, session polling, observation, and highlights. An in-flight host request cannot be aborted through this API; its generation token prevents stale results from being painted or another page being requested.

Paging errors/stalls and manual stop retain rendered matches and explicitly label them incomplete. Existing matching and query behavior have not been redesigned.

## Acceptance layers (do not conflate)

1. **Logic and contract fixtures**: `npm run check` runs pure logic, registration, and React 18 + jsdom synthetic session tests. These assert old/new structural adapters, multiple views (including the same session twice), ambiguity, hidden/mismatched roots, scoped results, paging failure, in-flight switching, timer/highlight teardown, and no browser-wide fallback. Geometry is mocked in jsdom; this is not a real host/browser acceptance result.
2. **Actual Web runtime + synthetic sessions**: installation of the same packed artifact, real module loader/slot rendering, paging, multiple view transitions and the host-supported disable/re-enable lifecycle must be recorded for each target release. A browser fixture alone cannot pass this layer.
3. **Target Electron Desktop smoke**: the same artifact must be checked on the target Desktop build/OS. Web or jsdom success does not pass this layer.

Candidate releases: `0.1.5-rc.2`, `0.1.5-rc.3`, `0.1.6-alpha.1`, `0.1.6-alpha.2`, `0.1.7-alpha.1`, `0.1.7-alpha.2`, `0.1.7-rc.1`, `0.1.7-rc.2`, `0.2.0-rc.1`, `0.2.0-rc.2`.

The 2026-10-02 registry audit compared every published `@deepseek-ai/dsh` version with main's three peer requirements (`>=0.1.5-rc.2 <0.1.6-0 || >=0.1.6-0 <0.2.0-0`) using the official prerequisite rule. The original six-target sample accidentally excluded four releases that the old gate admitted: `0.1.6-alpha.1`, `0.1.7-alpha.1`, `0.1.7-alpha.2`, and `0.1.7-rc.1`. The ten-target candidate includes all currently published versions admitted by that old gate plus both current 0.2 release candidates. The user's Desktop 2.0.14 report identifies its bundled runtime as `0.1.7-rc.1`; Desktop marketing/version labels are not inferred to equal DSH runtime versions.

The four added targets' official tagged slot, session props, conversation skeleton and HMR sources were inspected, and their vendor package pins are recorded in `scripts/compat/vendor-versions.json`. Links: [0.1.6-alpha.1](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.6-alpha.1/packages/client), [0.1.7-alpha.1](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.7-alpha.1/packages/client), [0.1.7-alpha.2](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.7-alpha.2/packages/client), [0.1.7-rc.1](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.7-rc.1/packages/client).

Every candidate must pass the same new tgz in real Web acceptance, including first Ctrl+F with body focus and no preparatory anchor click. Previous artifact results cannot validate changed production bytes. Desktop acceptance is separately recorded, including a Windows Web run for platform-specific harness behavior. The exact peer list enables verification without exemptions; it is not a passed support matrix. The historical `dshReleases` record is unchanged. Before release, failures must be fixed or clearly documented; removing a previously accepted target requires an explicit reviewed compatibility decision, not silent narrowing.

The official [compatibility evaluator](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/boot/app-boot/src/plugin-compatibility.ts) uses `semver.satisfies(..., { includePrerelease: true })`. Do not infer its results from ordinary npm semver behavior. Do not remove peer requirements or grant an exemption to make the matrix appear green.

## Reproduction

```sh
npm ci --ignore-scripts --legacy-peer-deps
npm run check
npm_config_cache=/tmp/find-all-npm-cache npm run verify:release
npm pack --ignore-scripts --pack-destination /tmp/find-all-candidate
# Extract this one tgz, retain its SHA-256, then test those bytes:
FIND_ALL_PACKAGE_ROOT=/tmp/find-all-candidate/package node --test test/session-adapter.test.mjs
```

`--legacy-peer-deps` here is only for isolated development test dependencies; it is not a host installation result or exemption. Test sessions must be synthetic, with no user data or model credentials. Do not change the artifact between version runs. Unknown future host versions need fresh regression evidence before changing support metadata.

## Host lifecycle boundary

The official HMR client in [0.1.5-rc.2](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/packages/client/hmr/src/client/index.ts) and [0.1.5-rc.3](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.3/packages/client/hmr/src/client/index.ts) deliberately ignores graph changes after initial load. These hosts and [0.1.6-alpha.1](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.1/packages/client/hmr/src/client/index.ts) require a page refresh or application restart after enabling/disabling a plugin. We do not patch the host or claim hot unload works there. Their acceptance checks wait for the actual server graph change, then verify disabled/restored behavior after an explicit refresh.

The inspected HMR clients in [0.1.6-alpha.2](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.2/packages/client/hmr/src/client/index.ts), [0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.2/packages/client/hmr/src/client/index.ts), [0.2.0-rc.1](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/client/hmr/src/client/index.ts), and [0.2.0-rc.2](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/client/hmr/src/client/index.ts) synchronize graph entries. The newly inspected 0.1.7-alpha.1, alpha.2 and rc.1 use the same `entries.sync` mechanism. Their acceptance checks require two real hot disable/re-enable cycles with zero page navigations. Every target must also pass actual search, history paging, and A/B/A session switching using the same candidate tgz. See the PR's linked CI evidence for run-specific results and artifact hashes; pending matrix entries are not passes. All Electron Desktop targets remain unverified until separately recorded.

## Windows validation isolation

The runner preserves its real `USERPROFILE`; DSH state and Electron `--user-data-dir` use owned temporary directories. A bounded no-inspector comparison changes only `USERPROFILE` (with separate evidence log filenames) before the UI smoke. It records crash/survival, not a UI pass. No real user profile, credentials, sandbox or security policy is changed. Windows Web validation invokes the npm `.cmd` shim through PowerShell with literal arguments and imports resolved modules through `pathToFileURL`.

## Simultaneous embedded sidebar boundary

The official rc2 [SidebarChatTab](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/client/ui-subagent/src/client/sidebar-chat/index.tsx) renders an embedded ConversationContent with `data-conversation-content`, `data-conversation-session` and `data-content-phase`, without the main panel's `data-phase` or a session header utility. This unsupported view must block neutral fallback to another conversation; explicit interaction with it remains rejected after it disappears. Fixtures cover visible registered Hero/settling/unknown phases, hidden utilities and headerless sidebars.

The current rc2 real-host case authors a completed one-shot child with the official persisted header/descriptor/catalog pattern from [subagent-conversation.e2e.ts](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/apps/web/tests/subagent-conversation.e2e.ts), opens the host's actual right-sidebar control, and natively re-enables the plugin with both views visible. It requires neutral Ctrl+F to reject ambiguity, an explicit main choice to remain scoped, and unsupported sidebar interaction to reject main-session search. No model is called and no second DOM pane is fabricated. The CI result for each artifact determines whether this case passed.
