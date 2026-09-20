# 版权与致谢 / Copyright and credits

## 上游项目 / Upstream

本仓库是 [secyborg/dsh-find-bar](https://github.com/secyborg/dsh-find-bar) 的 fork。

| 项 | 值 |
| --- | --- |
| 上游项目 | `dsh-find-bar` |
| 上游作者 | secyborg |
| 上游仓库 | https://github.com/secyborg/dsh-find-bar |
| Fork 依据的快照 | commit `ce7eb75efe94d768127c5977c649ecd950a9356c`（"initial release: 0.1.0"，2026-08-25） |
| 上游许可证 | MIT，`Copyright (c) 2026 secyborg` |

上游的 MIT 许可证要求"上述版权声明和许可声明应包含在本软件的所有副本或实质性部分中"。本仓库据此**完整保留**了：

- `LICENSE` —— 上游许可证原文，**未作任何修改**（包括版权行）；
- `README.fork-origin.md` —— 上游 README 原文，未作修改；
- `lib/index.js`、`lib/client.js`、`test/find-logic.test.mjs` 的文件头注释均注明来源为上游 fork。

## 本 fork 的修改 / Modifications in this fork

相对上游快照 `ce7eb75`，本仓库改动如下（原上游功能一律保留）：

1. 插件与包的名称、cordis 行 id：`dsh-find-bar` → `dsh-find-all`；
2. **新增"整段会话"搜索**：通过会话服务 `ctx.sessions`（`binding(id).session.loadOlder()` + 快照里的 `hasMore`）把尚未加载的历史分页拉进页面，每页之后重跑匹配，使命中计数覆盖整段对话；宿主读不到 `hasMore` 时退化为"翻到页面不再变化为止"；
3. 新增范围切换（`整段` / `本页`）、进度提示（含点击停止）、加载页数上限与会话切换时的状态重置；
4. `test/find-logic.test.mjs` 由上游测试改写为 `node:test` 并扩充：新增匹配器、键盘路由与分页状态机的 19 项用例；
5. 新增 README、`NOTICE.md`（本文件）与仓库元数据。

上游原有的查找条 UI、CSS Custom Highlight 高亮、`n/N` 计数、回车/`⌘G`/`F3` 导航、`window.find()` 退化路径**均未改动逻辑**。

## 本 fork 的版权 / Copyright of this fork

`LICENSE` 是标准的 MIT 双版权署名，两行都写明了：

```
Copyright (c) 2026 secyborg      ← 上游 dsh-find-bar
Copyright (c) 2026 Ryuu-64       ← 本 fork dsh-find-all 的修改部分
```

- 上游部分的版权归 **secyborg**，本仓库不对上游代码主张任何额外权利；
- 本仓库新增/修改的部分版权归 **Ryuu-64**，同样以 MIT 发布。任何人使用本仓库时，这两行版权声明都要一并保留。
