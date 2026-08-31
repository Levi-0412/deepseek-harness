---
description: "Serve RD-Agent trace logs and local quant-experiment trees to DSH Web surfaces over two read-only HTTP prefixes, converting pickled RD-Agent messages with the RD-Agent environment's own storage layer."
kind: "package-reference"
---

# @deepseek-ai/dsh-rdagent-bridge

English | [中文](README.zh.md)

## Summary

Mount this plugin to browse a quant run's on-disk record from the DSH Web GUI: RD-Agent trace directories under `logDir`, and local experiment trees under `experimentRoot`. It registers the read-only `/rdagent` and `/experiments` prefixes on `ctx.webServer`; pickled RD-Agent messages are converted by `pythonBin` running the packaged `scripts/parse_trace.py` so tags and contents match the RD-Agent Streamlit UI, while local manifests, metric files, and artifacts are parsed in-process. Each trace request costs one Python process. Nothing here reaches a model request or the session log.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the row with a `logDir` pointing at the RD-Agent checkout's `log` folder, and pair it with [`@deepseek-ai/dsh-client-ui-rdagent`](../../client/ui-rdagent/README.md), the browser panel that renders what these routes answer.

### When to choose it

Choose it when a deployment already writes RD-Agent traces, or local `quant-experiment` trees, and a Web surface should read them beside the conversation. Avoid it when nothing on the host produces those formats: with no `logDir` and no experiments the routes answer empty lists, and the shipped Web row stays disabled until `DSH_RDAGENT_LOGDIR` is set. The bridge is read-only in both directions — it never starts, resumes, or writes an RD-Agent run.

### Minimal configuration

```yaml
plugins:
  - id: rdagent-bridge
    name: '@deepseek-ai/dsh-rdagent-bridge'
    config:
      logDir: '<RD-Agent>/log'
      pythonBin: '<RD-Agent>/.venv/Scripts/python.exe'
      experimentRoot: '<project>/experiments'
```

| Field | Default | Meaning |
|---|---|---|
| `logDir` | required | Root directory holding RD-Agent trace folders. A missing directory fails the request that reads it. |
| `pythonBin` | `python` | Python executable that can import `rdagent`; must match the environment the traces were produced in. |
| `parseScript` | packaged `scripts/parse_trace.py` | Converter override. |
| `experimentRoot` | none | Root directory holding local experiment trees (`experiments/<name>/`); empty leaves `/experiments` unregistered. |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-rdagent-bridge) is the exhaustive source for every accepted field.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`apply` resolves `logDir` and `experimentRoot` once at load and registers route prefixes through `ctx.webServer.register({ kind: 'prefix', … })`, returning their combined disposer so the routes live exactly as long as the plugin fiber. One handler serves both prefixes, answers `405` to anything but `GET`, and converts a thrown error into a `500` whose message the panel displays; unexpected input is a `400`.

| Route | Answers |
|---|---|
| `GET /rdagent/traces` | `{ traces: [{ id, updatedAt, pklCount }] }`, newest first, without Python. Trace ids may be one or two path segments (`<timestamp>` or `<experiment>/<timestamp>`). |
| `GET /rdagent/trace?id=&limit=&tag=` | The converted trace: `{ trace, count, messages: [{ tag, timestamp, pid, content }] }`. `limit` defaults to 2000; `tag` filters by substring. |
| `GET /experiments` | `{ experiments: [{ name, source, runs, artifacts, warnings?, summary? }] }`, RD-Agent groups first (one per trace subdirectory, plus `未分组` for traces at the root), then local experiments. |
| `GET /experiments/run?exp=&run=` | The experiment's `runs`, `artifacts`, `warnings`, derived `series`, up to three text `reports`, and — when `run` names a known run — that run's `meta` and recursive `files`. |
| `GET /experiments/artifact?exp=&path=` | `{ exp, path, text }`, the decoded contents of one artifact (100 KB cap). |

The pickled-log path spawns `pythonBin` on [`scripts/parse_trace.py`](scripts/parse_trace.py) with `logDir` and the trace id, and parses its stdout as JSON; the script imports `rdagent.log.storage.FileStorage` so tags, ordering, and message contents come from RD-Agent's own reader. The child's `LOG_TRACE_PATH` is redirected to the OS temp directory, because importing `rdagent` creates a fresh trace folder. The local path is pure TypeScript in [`src/local.ts`](src/local.ts): manifests are read as JSON and, failing that, as JSON Lines; metric files are read as mapping, columnar, or bare-array series; text files are decoded from UTF-16LE or UTF-16BE byte order marks, then strict UTF-8, then GB18030. A directory walk is cached by modification time, and every path is resolved against its configured root with segment and depth limits, so `exp` and `path` cannot escape it.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@deepseek-ai/dsh-client-ui-rdagent`](../../client/ui-rdagent/README.md) — the panel that renders these routes.
- [`@deepseek-ai/dsh-host-webserver`](../../host/webserver/README.md) — the HTTP carrier these prefixes register on.
- [Configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-rdagent-bridge) — every accepted config field, generated from source.
- [RD-Agent integration Agent Note](../../../.agents/notes/implemented/feature/2026-08-20-rdagent-trace-bridge-and-panel.md) — why the pickles are parsed by RD-Agent's own environment, and what was rejected.

-----

<a id="model-experience"></a>
## Model Experience

None, as the bridge never alters model requests, tool execution, or session events; it only serves RD-Agent's and local experiments' own on-disk records to the browser.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The surface is read-only and per-request; what these limits cost is latency and cross-run analysis, never a model-visible effect.

- **One trace at a time** — `/rdagent/trace` returns a single trace's messages; cross-trace aggregation is left to the client.
- **Sync parse** — each RD-Agent trace request spawns a Python process (a few seconds on a full run); there is no cache, no streaming, and no cancellation of an in-flight child.
- **Read-only surface** — starting, resuming, or monitoring RD-Agent runs from DSH is out of scope; the bridge renders existing traces.
- **`pythonBin` must match the RD-Agent environment** — a mismatched interpreter fails the request with the child's stderr, and nothing detects the mismatch up front.
- **Manifest variation is tolerated, not validated** — a local experiment whose files match none of the recognized layouts degrades to a row without a summary chip or to pretty-printed JSON instead of failing loud.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The feature decision, the rejected alternatives, and the required verification are recorded in the [RD-Agent integration Agent Note](../../../.agents/notes/implemented/feature/2026-08-20-rdagent-trace-bridge-and-panel.md). Route behavior is pinned by [`tests/route.spec.ts`](tests/route.spec.ts), which boots the plugin through the Loader and answers with a stub `pythonBin`.

</details>

**Runtime invariant:** No companion is published. The plugin owns one route registration per prefix, whose disposal is the plugin fiber's own effect, and every other value it produces is per-request; no independent observation can diverge from that pair.
