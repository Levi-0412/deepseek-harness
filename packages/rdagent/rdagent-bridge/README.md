# @deepseek-ai/dsh-rdagent-bridge

English | [中文](README.zh.md)

Host-side bridge that serves [RD-Agent](https://github.com/microsoft/RD-Agent) trace logs to DSH browser plugins. Registers the `/rdagent` prefix route on [`ctx.webServer`](../../host/webserver/README.md) with two read-only GET endpoints; the pickled RD-Agent `Message` logs are converted to JSON by a Python child process running [`scripts/parse_trace.py`](scripts/parse_trace.py), which reuses `rdagent.log.storage.FileStorage` so tags match the Streamlit UI exactly.

## Config

| Key | Required | Default | Meaning |
|---|---|---|---|
| `logDir` | yes | — | Root directory holding RD-Agent trace folders (e.g. the RD-Agent checkout's `log` folder). Missing at request time fails loud. |
| `pythonBin` | no | `python` | Python executable that can import `rdagent`; must point at the RD-Agent environment (e.g. `<RD-Agent>/.venv/Scripts/python.exe` on Windows). |
| `parseScript` | no | packaged `scripts/parse_trace.py` | Override the converter script. |
| `experimentRoot` | no | — | Root directory holding local quant-experiment trees (`experiments/<name>/`). When set, the `/experiments` routes serve the unified experiment tree (RD-Agent groups + local experiments, read-only). |

```yaml
plugins:
  - id: rdagent-bridge
    name: '@deepseek-ai/dsh-rdagent-bridge'
    config:
      logDir: '<RD-Agent>/log'
      pythonBin: '<RD-Agent>/.venv/Scripts/python.exe'
```

## Endpoints

- `GET /rdagent/traces` — `{ traces: [{ id, updatedAt, pklCount }] }`, newest first, no Python involved.
- `GET /rdagent/trace?id=<trace>&limit=<n>&tag=<substring>` — `{ trace, count, messages: [{ tag, timestamp, pid, content }] }`. `content` is serialized best-effort (scalars verbatim, DataFrames as shape/columns/head, domain objects via friendly attributes, fallback `str()`). `id` is path-normalized and confined to `logDir`; escapes answer 400.

The prefix deliberately avoids `/api` (the connection plugin owns it for the envelope protocol); these are plain same-origin data endpoints.

## Model Experience

None, as the bridge never alters model requests, tool execution, or session events; it only serves RD-Agent's own on-disk logs to the browser.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- **One trace at a time** — `trace` returns a single trace's messages; cross-trace aggregation is left to the client.
- **Sync parse** — each `trace` request spawns a Python process (a few seconds on a full run); no caching or streaming yet.
- **Read-only surface** — starting/monitoring RD-Agent runs from DSH is out of scope; the bridge only renders existing traces.
- **`pythonBin` must match the RD-Agent env** — a mismatched interpreter fails the request with the child's stderr.
