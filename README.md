# dsh-find-all

DSH 的会话查找插件。按 **⌘F / Ctrl+F** 查找当前会话中的消息，跳到想看的地方。

## 安装

1. 打开 DSH 的「插件」→「添加插件」。
2. 输入 `@ryuu-64/dsh-find-all`，安装并启用。
3. 重启 DSH（网页版需重启服务并刷新页面）。

如果装过 `dsh-find-bar`，请先卸载，避免快捷键冲突。

## 使用

- **打开查找**：按 `⌘F / Ctrl+F`，输入关键词。
- **切换结果**：按 `Enter` / `Shift+Enter`；也可点击结果数量，输入序号后按 `Enter` 跳转。
- **调整搜索**：点 `⋯`，切换「完整会话 / 已加载内容」，或勾选思考、工具等内容。默认搜索用户消息和助手回复。
- **搜索新消息**：点 `⋯` →「重新读取最新会话历史」。
- **停止搜索**：点查找栏里正在搜索的状态提示。
- **关闭查找**：按 `Esc`；选项展开时会先收起选项。

「完整会话」搜索已保存的消息；如果无法使用，可改选「已加载内容」。不搜索图片里的文字或附件内容。最多显示前 5000 个结果；没搜完或无法准确跳转时会提示。

搜索在你的设备上完成，不改动聊天记录，也不会把聊天内容发送给其他服务。

## 更新

在 `⋯` 中点「检查更新」。有新版时，去 DSH「插件」页卸载本插件，再按上面的步骤重新安装并重启 DSH。

## 反馈与交流

遇到问题请[到 GitHub 反馈](https://github.com/Ryuu-64/dsh-find-all/issues/new)，说明你做了什么、遇到什么问题，附上必要截图。可点 `⋯` →「复制诊断信息」后粘贴到反馈中。不要公开密钥或私密对话。

QQ 交流群：**1129212995**。需要跟进的问题请到 GitHub 反馈。

点 `⋯` →「关于」可查看作者、联系方式与项目链接。

## 作者与致谢

由 [Ryuu-64](https://github.com/Ryuu-64) 维护，基于 [secyborg/dsh-find-bar](https://github.com/secyborg/dsh-find-bar) 开发，感谢 secyborg 的原作。

[MIT 许可](LICENSE)：Copyright (c) 2026 secyborg / Copyright (c) 2026 Ryuu-64。
上游 README 见 [README.fork-origin.md](README.fork-origin.md)，改动与致谢见 [NOTICE.md](NOTICE.md)。
