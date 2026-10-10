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

1. 插件的名称与 cordis 行 id：`dsh-find-bar` → `dsh-find-all`（npm 包名：`@ryuu-64/dsh-find-all`）；
2. **新增完整会话搜索**：通过正式 `ctx.remote.session.follow/page` 接口读取固定截点的已保存历史，验证事件序号连续覆盖，在内存文字上搜索，并在选择命中时按需定位原聊天；
3. 新增范围切换（`完整会话` / `已加载内容`）、读取与扫描进度（含点击停止）、独立结果展示上限与会话切换时的状态重置；
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

## React server text projection

The client bundle includes the React DOM 18.3.1 server renderer. It uses the Host's existing React runtime to turn the Host's public text components into inert text projections. React DOM is distributed under the MIT License:

Copyright (c) Facebook, Inc. and its affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
