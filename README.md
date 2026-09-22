# dsh-find-all

DSH web 插件：给桌面 App（Electron 壳）补上 **⌘F / Ctrl+F 页内查找**，并且**搜的是整段会话，不只是屏幕上已经渲染出来的那一截**。

> **Fork 自 [secyborg/dsh-find-bar](https://github.com/secyborg/dsh-find-bar)**（作者 secyborg，MIT）。
> Fork 依据的快照：commit `ce7eb75efe94d768127c5977c649ecd950a9356c`（0.1.0，2026-08-25）。
> 版权与许可是 MIT 双署名：`LICENSE` 里**同时**保留上游 `Copyright (c) 2026 secyborg` 与本 fork `Copyright (c) 2026 Ryuu-64`；上游 README 原样留作 `README.fork-origin.md`；改动清单与致谢见 `NOTICE.md`。
>
> 本仓库只做一件上游做不到的事：**把没加载进来的历史翻进来再搜**。

## 为什么需要它

DSH 桌面窗口是 Electron，本身没有浏览器那种查找栏；而会话视图**一次只保留最近 50 条消息**在页面里（点一次「加载更早」再多 50 条）。所以用普通查找条搜一个存在于更早历史里的词，结果永远是 0——哪怕这段会话里明明有。

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

## 它是怎么搜到"还没显示出来"的内容的

插件先问会话服务"现在是哪个会话"，然后一页一页地请它把更早的消息加载出来（一页 50 条）。每加载完一页就重新搜一遍，所以计数和高亮最后覆盖的是整段会话。
"还有没有更早的"由会话服务自己报；报不出来的时候，它就一直翻到页面不再变化为止。

（给开发者：用的是客户端 `sessions` 服务——`ctx.sessions.list.getSnapshot().current` 取当前会话、`ctx.sessions.binding(id).session` 取会话面，翻页调 `loadOlder()`，判断用快照里的 `hasMore`。）

## 安装

```sh
dsh plugin --profile desktop add @ryuu-64/dsh-find-all
```

装完**完整重启一次 DSH Desktop**（插件清单只在启动时装载）。

不想走 npm 就装本地源码（改完不用重新打包，重启即可）：

```sh
dsh plugin --profile desktop add link:/path/to/dsh-find-all
```

### 不依赖 npm 的安装（profile 用本仓库打好的 tarball）

当 registry 上还是旧版本（或发布被 2FA 卡住）时用这条：脚本把本仓库 `npm pack` 出来的
tarball **拷进 profile 目录**，并把依赖改成 `file:./dsh-find-all-<版本>.tgz`。pnpm 从它安装，
**以后再跑 `pnpm install` 也只会从这个 tarball 重装，不会去 registry 把旧版本拉回来**；
tarball 放在 profile 里（而不是仓库里），所以仓库的 `git clean -xfd` 不会把它扫掉，
锁文件里存的也是相对路径。

```sh
npm run install:local          # 打包 → 校验 tarball 里的注册 id → 装进 profile → 逐字节自证
```

换回 registry 版本（发布成功之后）：

```sh
npm run deploy:profile         # 把依赖改回 ^<版本>，并证明装出来的字节与 registry 产物一致
```

> `deploy:profile` 会先确认目标版本**确实已发布**（否则拒绝并保持 profile 不变），
> 所以不会出现"依赖指向一个解析不到的版本、下次 install 直接崩"的情况。

> 注意：它与 `dsh-find-bar` **都会抢 Ctrl+F**，请只保留一个：
> ```sh
> dsh plugin --profile desktop remove dsh-find-bar
> ```

## 排障：GUI 报「Failed to load plugins / 部分插件加载失败」

如果报错长这样：

```text
failed to import loader entry <id>: client-modules: bundle /plugins/??...&rev=... 
loaded without registering "@ryuu-64/dsh-find-all" via __ModuleLoader__.load
```

**这不是 DSH 版本不兼容，别去恢复模式卸载、也别新建 Profile。** 它只有一个含义：
`lib/client.js` 里 `window.__ModuleLoader__.load({ id })` 的 id 与**包名**不一致。

宿主（`@deepseek-ai/dsh-client-modules`）用「解析出的 package.json 包名」当浏览器模块身份
（规范的 `WebBootEntry.id` 注释就是 *Entry name == package name*），
`ClientModuleSystem.arrive()` 在脚本加载成功后按这个 key 查 factory 表，查不到就抛这一句。

0.1.0 就是这个毛病：fork 自非 scoped 的 `dsh-find-bar` 时，包名改成 `@ryuu-64/dsh-find-all`，
bundle 里的 id 却写成了裸名 `dsh-find-all`。0.1.1 已修，并加了门禁：

```sh
npm run check:registration   # 期望值从 package.json 读，比 bundle 实际注册值
npm run verify:release       # 打包成 tarball 再验一遍（发布前跑）
```

> **Fork / 改名提醒**：给 scoped 包 fork 一个非 scoped 包时，危险的不是包名本身，
> 而是散落在 bundle 里的**派生字面量**。官方工具链（`packages/client/tsdown.client.ts`
> 的 `clientBundle(id, ...)`）把 id 当参数盖章，社区脚手架（`create-dsh-plugin`）用
> `{{PKG_NAME}}` 模板变量注入——都是为了让这个字面量无法被手写错。
> 本包的 bundle 是手写并入库的，所以用上面两条命令代替盖章。

## 卸载 / 回退

```sh
dsh plugin --profile desktop remove @ryuu-64/dsh-find-all   # 卸载
dsh plugin --profile desktop add dsh-find-bar               # 退回上游那个插件
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
