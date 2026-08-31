---
description: "The rdagent package group: the host-side bridge that serves RD-Agent trace logs and local quant experiment trees to DSH Web surfaces."
kind: "package-group"
---

# rdagent/ — RD-Agent integration group

English | [中文](README.zh.md)

## Summary

The `rdagent/` packages connect the DSH Web GUI to [RD-Agent](https://github.com/microsoft/RD-Agent), Microsoft's LLM-driven quantitative R&D framework, whose runs write pickled trace logs that only its own Streamlit UI can read. The host-side bridge serves those traces, and local quant-experiment trees, as JSON over read-only HTTP routes for a browser panel to render. Use this group when a deployment already produces those on-disk records and wants them visible beside the conversation; the RD-Agent installation itself, with its venv, qlib data, and `.env`, stays outside this repository.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

One package serves the records; the panel that renders them belongs to the client group.

| Package | Role | ctx key |
|---|---|---|
| [`rdagent-bridge/`](rdagent-bridge/README.md) | Serves RD-Agent traces and local experiment trees as JSON over the `/rdagent` and `/experiments` HTTP prefixes, converting pickled messages with the RD-Agent environment | registers on `ctx.webServer` |

-----

<a id="related-documentation"></a>
## Related documentation

- [`@deepseek-ai/dsh-client-ui-rdagent`](../client/ui-rdagent/README.md) — the browser panel that renders these routes.
- [RD-Agent integration Agent Note](../../.agents/notes/implemented/feature/2026-08-20-rdagent-trace-bridge-and-panel.md) — why the pickles are parsed by RD-Agent's own environment.
- [Host webserver](../host/webserver/README.md) — the HTTP carrier these routes register on.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
