# dsh-find-all 对话全文搜索

[English](https://github.com/Ryuu-64/dsh-find-all/blob/main/README.md) | 简体中文

在 DeepSeek Harness（DSH）中搜索各工作区对话的标题和已保存正文，也可以按 **⌘F / Ctrl+F** 查找当前对话。

## 效果预览

记得聊过「离线导出」，却忘了在哪个对话？输入关键词，从正文片段中找回它。

![在所有工作区搜索「离线导出」，结果显示两个对话的正文片段](https://raw.githubusercontent.com/Ryuu-64/dsh-find-all/main/docs/screenshots/conversation-search.png)

截图来自 DSH `0.2.2-rc.3` Web 上运行的源码版，使用演示对话。

## 当前版本与安装

npm 已发布的 **`0.1.15`** 最高支持 DSH **`0.2.1-rc.3`**。如果你用的是 DSH **`0.2.2-rc.3` Web**，请用下面的源码安装方式。下文标注「源码版」的功能尚未发布到 npm。

如果装过 `dsh-find-bar`，请先卸载，避免快捷键冲突。

### 安装 npm 已发布版

1. 打开 DSH 的「插件」→「添加插件」。
2. 输入 `@ryuu-64/dsh-find-all`，安装并启用。
3. 重启 DSH（网页版需重启服务并刷新页面）。

### 在 DSH 0.2.2-rc.3 Web 上安装源码版

在运行 DSH Web 服务的机器上准备 Node.js `24.9.0` 或更新的 24 系列版本，确认 `git`、`npm`、`pnpm` 和 `dsh` 可在终端运行。仓库已包含构建好的 `lib/`，可以直接打包。

```sh
git clone https://github.com/Ryuu-64/dsh-find-all.git
cd dsh-find-all
npm pack --ignore-scripts --pack-destination "$HOME"
dsh plugin --profile web add "$HOME/ryuu-64-dsh-find-all-0.1.15.tgz" --ignore-scripts
```

配置档会引用这个 `.tgz`，请保留文件。若你用的是自定义 Web 配置档，请将 `web` 换成对应名称。用原来的启动命令重启同一配置档的 Web 服务，再刷新浏览器。

## 从搜索结果找到原文

1. 点侧栏「对话全文搜索」，输入「离线导出」。标题和正文一起搜索，结果会显示对话标题、工作区和含关键词的正文片段。
2. 点「报表功能设计」。插件会打开对话，并在查找栏里继续查找「离线导出」。打开后的高亮位置可能与搜索摘要不同。
3. 点查找栏的结果数量，输入 `2`，按 `Enter` 定位到第二处。点「返回搜索结果」，可以回到原查询和列表位置。

![打开「报表功能设计」后沿用「离线导出」查找，结果计数为 2/2，正文高亮第二处](https://raw.githubusercontent.com/Ryuu-64/dsh-find-all/main/docs/screenshots/in-conversation-find.png)

已经打开目标对话时，直接按 `⌘F / Ctrl+F`。用 `Enter` 和 `Shift+Enter` 切换匹配，按 `Esc` 关闭查找。

## 常用设置与限制

- **跨工作区搜索**可勾选「仅标题」或「包含归档」。结果较多时点「继续加载结果」。要打开归档对话，先点「取消归档并打开」。对话有更新时，在搜索框按 `Enter` 重新搜索。
- **当前对话查找**默认搜索用户消息和助手回复。点 `⋯`，可在「完整会话」与「已加载内容」间切换，也可选思考过程、工具等内容类型。完整会话不可用时，可用「已加载内容」继续查找。
- **保存搜索默认值（源码版）**需要宿主提供插件配置表单。从侧栏「插件」打开本插件，再点组件行的「配置」。可为当前配置档设置默认只搜标题、默认包含已归档对话，下次打开搜索窗口时生效。

![当前对话查找菜单展开，显示「完整会话」「已加载内容」及可选内容类型](https://raw.githubusercontent.com/Ryuu-64/dsh-find-all/main/docs/screenshots/find-options.png)

### 更新

已发布的 `0.1.15` 可从查找栏 `⋯` →「检查更新」查看版本。需要手动更新时，在当前配置档卸载，再从「插件」安装与宿主兼容的已发布版本。宿主提示重启时，重启后再使用。

源码版可从 `⋯` →「在 DSH 中管理插件」打开插件详情。宿主提供「版本」区且插件从 npm 安装时，点「重新检查」查看可安装的兼容版本。

### 搜索范围与隐私

- 跨对话搜索只查当前连接的 DSH 服务中的普通对话，覆盖已保存的用户消息和已完成的助手正文。它按原始 Markdown 做字面匹配，不区分大小写，跳过思考、工具、子代理、附件和图片文字。
- 大型历史可能需要等待。未扫完或有读取失败时，结果区会提示。当前对话查找最多显示 5000 处匹配。
- 搜索不改聊天记录，也不把搜索词或正文发给外部 AI。**跨对话搜索**由 DSH 服务扫描正文，浏览器收到的是匹配片段和对应的对话信息。**当前对话的完整会话查找**会读取该对话的历史。

## 反馈与详细文档

遇到问题请[到 GitHub 反馈](https://github.com/Ryuu-64/dsh-find-all/issues/new)，说明你做了什么、遇到什么问题，附上必要截图。可点 `⋯` →「复制诊断信息」后粘贴到反馈中。不要公开密钥或私密对话。

QQ 交流群 **1129212995**。跨对话搜索的规则也可在面板的「搜索说明」中查看。版本与平台细节见[兼容说明](https://github.com/Ryuu-64/dsh-find-all/blob/main/docs/compatibility.md)。

## 作者与致谢

由 [Ryuu-64](https://github.com/Ryuu-64) 维护，基于 [secyborg/dsh-find-bar](https://github.com/secyborg/dsh-find-bar) 开发，感谢 secyborg 的原作。

[MIT 许可](https://github.com/Ryuu-64/dsh-find-all/blob/main/LICENSE)。Copyright (c) 2026 secyborg / Copyright (c) 2026 Ryuu-64。
上游 README 见 [README.fork-origin.md](https://github.com/Ryuu-64/dsh-find-all/blob/main/README.fork-origin.md)，改动与致谢见 [NOTICE.md](https://github.com/Ryuu-64/dsh-find-all/blob/main/NOTICE.md)。
