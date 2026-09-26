# 开发与发布

这份文档给**改这个插件的人**看。只想装来用的话，看 [`README.md`](README.md) 就够了。

## 仓库结构

```
lib/index.js     插件入口（cordis 行）
lib/client.js    客户端 bundle —— 构建产物，直接入库，没有打包步骤
test/            node:test 单元测试
scripts/         发布与安装脚本
cordis.patch.yml bundle 补丁声明
```

`lib/client.js` 与生态里其它插件一致：直接由 `window.__ModuleLoader__` 装载，所以**改完不需要打包**，重启 DSH Desktop 即可。

## 常用命令

```sh
npm test                      # 匹配逻辑、键盘路由、分页循环的单元测试
npm run check                 # 语法检查 + 注册 id 校验 + 测试
npm run check:registration    # 只跑：bundle 实际注册的 id 是否等于 package.json 的包名
npm run verify:release        # 打包成 tarball 再验一遍（发布前跑）
```

## 改装上游插件内容时的注意事项

上游原有的查找条 UI、CSS Custom Highlight 高亮、`n/N` 计数、回车 / `⌘G` / `F3` 导航、`window.find()` 退化路径**逻辑均未改动**。改动清单见 `NOTICE.md`。

## 坑：client bundle 的注册 id 必须等于包名

**症状**——GUI 报「Failed to load plugins / 部分插件加载失败」，日志长这样：

```text
failed to import loader entry <id>: client-modules: bundle /plugins/??...&rev=... 
loaded without registering "@ryuu-64/dsh-find-all" via __ModuleLoader__.load
```

**这不是 DSH 版本不兼容**，别去恢复模式卸载，也别新建 Profile。它只有一个含义：`lib/client.js` 里 `window.__ModuleLoader__.load({ id })` 的 id 与**包名**不一致。

宿主（`@deepseek-ai/dsh-client-modules`）用「解析出的 package.json 包名」当浏览器模块身份（规范的 `WebBootEntry.id` 注释就是 *Entry name == package name*），`ClientModuleSystem.arrive()` 在脚本加载成功后按这个 key 查 factory 表，查不到就抛这一句。

0.1.0 就是这个毛病：fork 自非 scoped 的 `dsh-find-bar` 时，包名改成了 `@ryuu-64/dsh-find-all`，bundle 里的 id 却写成了裸名 `dsh-find-all`。0.1.1 已修，并加了门禁：

```sh
npm run check:registration   # 期望值从 package.json 读，比 bundle 实际注册值
npm run verify:release       # 打包成 tarball 再验一遍（发布前跑）
```

> **Fork / 改名提醒**：给 scoped 包 fork 一个非 scoped 包时，危险的不是包名本身，而是散落在 bundle 里的**派生字面量**。官方工具链（`packages/client/tsdown.client.ts` 的 `clientBundle(id, ...)`）把 id 当参数盖章，社区脚手架（`create-dsh-plugin`）用 `{{PKG_NAME}}` 模板变量注入——都是为了让这个字面量无法被手写错。本包的 bundle 是手写并入库的，所以用上面两条命令代替盖章。

## 不依赖 npm 的安装（profile 用本仓库打好的 tarball）

当 registry 上还是旧版本（或发布被 2FA 卡住）时用这条：脚本把本仓库 `npm pack` 出来的 tarball **拷进 profile 目录**，并把依赖改成 `file:./dsh-find-all-<版本>.tgz`。pnpm 从它安装，**以后再跑 `pnpm install` 也只会从这个 tarball 重装，不会去 registry 把旧版本拉回来**；tarball 放在 profile 里（而不是仓库里），所以仓库的 `git clean -xfd` 不会把它扫掉，锁文件里存的也是相对路径。

```sh
npm run install:local          # 打包 → 校验 tarball 里的注册 id → 装进 profile → 逐字节自证
```

装本地源码（改完不用重新打包，重启即可）：

```sh
dsh plugin --profile desktop add link:/path/to/dsh-find-all
```

换回 registry 版本（发布成功之后）：

```sh
npm run deploy:profile         # 把依赖改回 ^<版本>，并证明装出来的字节与 registry 产物一致
```

> `deploy:profile` 会先确认目标版本**确实已发布**（否则拒绝并保持 profile 不变），所以不会出现「依赖指向一个解析不到的版本、下次 install 直接崩」的情况。

## 打包发布时的可见性

`package.json` 的 `files` 是白名单，目前只发布 `lib`、`cordis.patch.yml`、`README.md`、`CHANGELOG.md`、`NOTICE.md`、`LICENSE`。

这份 `CONTRIBUTING.md`、`test/`、`scripts/` 和本地 tarball **都不在发布范围内**——加新文件时如果想要（或不想要）它出现在 npm 包里，记得同时改 `files`。

## 版本号只能往前走

npm 的坐标一旦用过就不能复用，**包括只进了 staging、从没真正发布出去的版本**：

```text
409 Cannot publish over previously staged version "0.1.1"
409 Cannot stage previously published version "0.1.1"
```

0.1.1 就是这样：内容已修好，但坐标永久占用，于是同一份代码原样重发为 0.1.2。细节见 `CHANGELOG.md`。
