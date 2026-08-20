# rdagent/ — RD-Agent 集成组

[English](README.md) | 中文

与 [RD-Agent](https://github.com/microsoft/RD-Agent)（微软的 LLM 驱动量化研究框架）的宿主侧集成。将 RD-Agent 磁盘上的工件桥接到 DSH Web GUI。

| 包 | 角色 | ctx key |
|---|---|---|
| [`rdagent-bridge/`](rdagent-bridge/README.md) | 通过 `/rdagent` HTTP 路由将 RD-Agent trace 日志以 JSON 形式提供（Python 子进程） | 无（在 `ctx.webServer` 上注册路由） |

RD-Agent 安装本身（venv、conda qlib 环境、`.qlib` 数据、`.env`）位于本仓库之外的 RD-Agent 检出目录中；本组只包含 DSH 侧的适配器。
