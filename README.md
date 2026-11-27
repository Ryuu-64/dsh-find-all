# dsh-find-all for DeepSeek Harness

English | [简体中文](https://github.com/Ryuu-64/dsh-find-all/blob/main/docs/README.zh-CN.md)

npm: [@ryuu-64/dsh-find-all](https://www.npmjs.com/package/@ryuu-64/dsh-find-all) · Maintained by [Ryuu-64](https://github.com/Ryuu-64).

Search conversation titles and saved messages across workspaces in DeepSeek Harness (DSH), or press **⌘F / Ctrl+F** to find text in the current conversation.

## Preview

Search for `DOMAIN` across workspaces and browse the matching conversations from the right sidebar.

![DSH showing the conversation beside right-sidebar search results for DOMAIN from two workspaces](https://raw.githubusercontent.com/Ryuu-64/dsh-find-all/main/docs/screenshots/conversation-search.png)

## Install

Ask an AI assistant that can operate your computer to install the plugin.

> Install this plugin in my DSH setup, check compatibility, and confirm it is enabled: https://github.com/Ryuu-64/dsh-find-all

If you have `dsh-find-bar` installed, remove it first to avoid a shortcut conflict.

## Go from search results to the message

1. Open **Full-text conversation search** in the left sidebar or **Search** in the right sidebar tools, then enter `离线导出`. Results show titles, workspaces, and message excerpts.
2. Select a title to open a conversation, or select its excerpt to jump to that match. The right sidebar keeps your query, filters, and list position as you switch conversations.
3. In a narrow window, selecting a result collapses the fullscreen sidebar so you can read the conversation. Reopen Search to continue browsing.

On hosts and pages without a right sidebar, search opens in a dialog. A result passes its query to in-conversation find, and **Back to search results** restores the list position.

If the conversation is already open, press `⌘F / Ctrl+F`. Use `Enter` or `Shift+Enter` to move between matches and `Esc` to close the find bar.

Full-text conversation search has no default shortcut. To set one, find **Full-text conversation search** in DSH’s **Keyboard shortcuts** settings.

## Search options and limits

- **Across workspaces**, select **Titles only** or **Include archived** to change what you search. Select **Load more results** if the search has more conversations to scan. Use **Unarchive** on an archived result to restore it. Press `Enter` in the search field to rerun the search after conversations change.
- **In the current conversation**, the default search includes user messages and assistant replies. Open `⋯` to choose **Whole conversation** or **Loaded content**, or add content types such as reasoning and tool calls. Use **Loaded content** when whole-conversation search is unavailable.
- To **save search defaults**, open Find All under **Plugins** in the sidebar and select **Configure** on its component row. Set **Search titles only by default** and **Include archived conversations by default** for the current profile. Your choices apply the next time you open full-text search.

![Chinese find bar menu showing Whole conversation, Loaded content, and the available content types](https://raw.githubusercontent.com/Ryuu-64/dsh-find-all/main/docs/screenshots/find-options.png)

<a id="更新" name="更新"></a>

### Updating

In the find bar, open `⋯` and select **Manage plugin in DSH**. If **Versions** appears in the plugin details, select **Check again** to see compatible updates.

### What gets searched and where

- Cross-conversation search covers ordinary conversations on the connected DSH server. It searches saved user messages and completed assistant text as case-insensitive literal text in the original Markdown. Reasoning, tools, subagent conversations, attachments, and text inside images are outside its scope.
- Long histories can take time to scan. The results tell you when a scan is incomplete or some conversations could not be read. In-conversation find shows up to 5,000 matches.
- Search is read-only and keeps queries and messages within DSH. For cross-conversation search, the DSH server scans the messages and sends matching excerpts and conversation details to the browser. Whole-conversation find reads the history of the current conversation in the browser.

## Feedback and documentation

[Report an issue on GitHub](https://github.com/Ryuu-64/dsh-find-all/issues/new) with steps to reproduce the problem and any relevant screenshots. You can use `⋯` → **Copy diagnostics** to include troubleshooting details. Keep API keys and private conversations out of public issues.

The QQ group is **1129212995**. For search behavior, see **Search help** in the results. For supported versions and tested platforms, see the [compatibility notes](https://github.com/Ryuu-64/dsh-find-all/blob/main/docs/compatibility.md).

## Credits

Maintained by [Ryuu-64](https://github.com/Ryuu-64). Based on [secyborg/dsh-find-bar](https://github.com/secyborg/dsh-find-bar), with thanks to secyborg for the original plugin.

[MIT License](https://github.com/Ryuu-64/dsh-find-all/blob/main/LICENSE). Copyright (c) 2026 secyborg / Copyright (c) 2026 Ryuu-64.
See the [upstream README (Chinese)](https://github.com/Ryuu-64/dsh-find-all/blob/main/docs/upstream-readme.md) and [notices and credits](https://github.com/Ryuu-64/dsh-find-all/blob/main/NOTICE.md).
