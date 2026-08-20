# rdagent/ — RD-Agent integration group

English | [中文](README.zh.md)

Host-side integration with [RD-Agent](https://github.com/microsoft/RD-Agent), Microsoft's LLM-driven quantitative R&D framework. Bridges RD-Agent's on-disk artifacts into the DSH Web GUI.

| Package | Role | ctx key |
|---|---|---|
| [`rdagent-bridge/`](rdagent-bridge/README.md) | Serves RD-Agent trace logs as JSON over `/rdagent` HTTP routes (Python child process) | none (registers routes on `ctx.webServer`) |

The RD-Agent installation itself (venv, conda qlib env, `.qlib` data, `.env`) lives outside this repo in the RD-Agent checkout; this group only contains the DSH-side adapters.
