# dsh-find-all

DSH web 插件：给桌面 App（Electron 壳）补上 **⌘F / Ctrl+F 页内查找**，并且**搜的是整段会话，不只是屏幕上已经渲染出来的那一截**。

> **Fork 自 [secyborg/dsh-find-bar](https://github.com/secyborg/dsh-find-bar)**（作者 secyborg，MIT）。
> Fork 依据的快照：commit `ce7eb75efe94d768127c5977c649ecd950a9356c`（0.1.0，2026-08-25）。
> 版权与许可是 MIT 双署名：`LICENSE` 里**同时**保留上游 `Copyright (c) 2026 secyborg` 与本 fork `Copyright (c) 2026 Ryuu-64`；上游 README 原样留作 `README.fork-origin.md`；改动清单与致谢见 `NOTICE.md`。
>
> 本仓库只做一件上游做不到的事：**把没加载进来的历史翻进来再搜**。

## 为什么需要它

DSH 桌面窗口是 Electron，本身没有浏览器那种查找栏；而会话视图**一次只保留最近 50 条消息**在页面里（点一次「加载更早」再多 50 条）。所以用普通查找条搜一个存在于更早历史里的词，结果永远是 0——哪怕这段对话里明明有。

本插件在你输入关键词后，通过会话服务把更早的历史一页页加载进来，每加载一页就重搜一次，直到整段会话都在页面里。于是命中计数和高亮覆盖的是**整个会话**。

## 功能

- **⌘F / Ctrl+F** 唤起查找条（自动带入当前选中的文字）
- **范围切换**：`整段`（默认）↔ `本页`。点一下那个胶囊按钮切换
- **整段模式**：自动分页加载历史，边加载边更新高亮与计数
- **进度可见**：`正在加载更早的历史… 已 3 页`，**点一下这段文字即可停止**
- **安全上限**：最多加载 400 页（约 2 万条消息）；历史不再增长时会自行停止（宿主没有 `hasMore` 也能收敛）
- **导航**：Enter / Shift+Enter、⌘G / F3（+Shift）、Esc 关闭并清除高亮
- **高亮**：CSS Custom Highlight API 绘制，不改 DOM，与 React 渲染零冲突；不支持该 API 的环境退回 `window.find()`
- 切换会话时自动重置并重新开始搜索

## 原理（两个接口）

- `ctx.sessions`（由 `@deepseek-ai/dsh-api-session-controller` 提供）：`list.getSnapshot().current` 拿当前会话，`binding(id).session` 拿会话面。
- 会话面 `loadOlder()` 翻一页（50 条）；`getSnapshot().hasMore` 判断是否还有更早的历史。取不到时退回"翻到页面不再变化为止"。

## 安装

```sh
npm pack
dsh plugin --profile desktop add ./dsh-find-all-0.1.0.tgz
```

装完**完整重启一次 DSH Desktop**（插件清单只在启动时装载）。

> 注意：它与 `dsh-find-bar` **都会抢 Ctrl+F**，请只保留一个：
> ```sh
> dsh plugin --profile desktop remove dsh-find-bar
> ```

## 卸载 / 回退

```sh
dsh plugin --profile desktop remove dsh-find-all    # 卸载
dsh plugin --profile desktop add <dsh-find-bar-0.1.0.tgz>   # 退回原插件
```

## 已知限制

- 大小写不敏感，没有"区分大小写"开关
- 单次搜索最多记 5000 个命中
- 折叠起来的工具调用/思考块，其正文不在 DOM 里，搜不到（需要先展开）
- 第一次搜一个很长的会话要等几秒：那是真的在读历史（856 条 ≈ 17 页）

## 开发

```sh
npm test     # 匹配逻辑、键盘路由、分页循环的单元测试
npm run check
```

`lib/client.js` 就是构建产物（与生态里其它插件一致：直接由 `window.__ModuleLoader__` 装载），没有打包步骤。
