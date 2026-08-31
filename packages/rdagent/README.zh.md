---
description: "The rdagent package group: the host-side bridge that serves RD-Agent trace logs and local quant experiment trees to DSH Web surfaces."
kind: "package-group"
---

# rdagent/ — RD-Agent 集成组

[English](README.md) | 中文

## 概述

`rdagent/` 下的包把 DSH Web GUI 与 [RD-Agent](https://github.com/microsoft/RD-Agent)（微软的 LLM 驱动量化研发框架）连接起来——它的每次运行都会写出 pickle 化的 trace 日志，而只有它自带的 Streamlit UI 能读取这些日志。宿主侧 bridge 把这些 trace，以及本地量化实验树，通过只读 HTTP 路由以 JSON 形式提供给浏览器面板渲染。当部署已经在产出这些磁盘记录、并希望它们在对话旁边可见时使用本组；RD-Agent 自身的安装（venv、qlib 数据、`.env`）留在本仓库之外。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

由一个包负责提供这些记录；渲染它们的面板属于 client 组。

| 包 | 职责 | ctx key |
|---|---|---|
| [`rdagent-bridge/`](rdagent-bridge/README.zh.md) | 通过 `/rdagent` 与 `/experiments` HTTP 前缀把 RD-Agent trace 与本地实验树以 JSON 提供出去，并用 RD-Agent 环境转换 pickle 消息 | 注册在 `ctx.webServer` 上 |

-----

<a id="related-documentation"></a>
## 相关文档

- [`@deepseek-ai/dsh-client-ui-rdagent`](../client/ui-rdagent/README.zh.md)——渲染这些路由的浏览器面板。
- [RD-Agent 集成 Agent Note](../../.agents/notes/implemented/feature/2026-08-20-rdagent-trace-bridge-and-panel.zh.md)——为什么由 RD-Agent 自己的环境解析 pickle。
- [宿主 webserver](../host/webserver/README.zh.md)——这些路由注册所在的 HTTP 载体。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
