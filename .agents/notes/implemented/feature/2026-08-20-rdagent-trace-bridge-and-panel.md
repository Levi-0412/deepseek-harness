# Agent Note: RD-Agent trace bridge and experiment panel

Status: implemented

English | [中文](2026-08-20-rdagent-trace-bridge-and-panel.zh.md)

## Problem

An [RD-Agent](https://github.com/microsoft/RD-Agent) quant run writes everything it knows into a per-run trace directory of pickled `Message` objects under `<RD-Agent>/log`, and its own Streamlit UI is the only reader of that format. Reviewing a factor-research loop from the DSH Web GUI therefore meant either running a second web application beside it or shelling out to a script per question, and neither shares the GUI's theme, session context, or authentication. Local quant experiments written by the sibling `quant-experiment` project have the opposite problem: small JSON manifests that any text editor can open, but no lens that compares runs or shows where a run's artifacts live.

## Decision

Two packages own the integration, one per plane.

[`@deepseek-ai/dsh-rdagent-bridge`](../../../../packages/rdagent/rdagent-bridge/README.md) is a Host plugin that registers two prefix routes on `ctx.webServer`: `/rdagent` for pickled RD-Agent logs and `/experiments` for local experiment trees. `logDir`, `pythonBin`, `parseScript`, and `experimentRoot` are validated `Config` fields, so a deployment points the bridge at its own checkout from `cordis.yml` and the shipped row stays disabled until `DSH_RDAGENT_LOGDIR` is set. The pickled-log endpoint spawns the packaged [`scripts/parse_trace.py`](../../../../packages/rdagent/rdagent-bridge/scripts/parse_trace.py) through `pythonBin` and serializes its JSON; that script reuses `rdagent.log.storage.FileStorage`, so tags, ordering, and message contents match the Streamlit UI that produced the logs instead of a reimplementation of the pickle format. The local-experiment endpoints parse manifests and metric files in-process ([`src/local.ts`](../../../../packages/rdagent/rdagent-bridge/src/local.ts)), tolerate the three series layouts the project emits (mapping, columnar, bare array) and both manifest encodings (JSON and JSON Lines), and read UTF-16LE and GB18030 text that Windows tooling left behind. Every route is read-only: paths are normalized and confined to their configured root, and a request that escapes it answers 400.

[`@deepseek-ai/dsh-client-ui-rdagent`](../../../../packages/client/ui-rdagent/README.md) is the browser half: one `sidebar.footer.action` entry beside Settings that toggles a right-side drawer. The drawer lists one two-level tree over `/experiments` (RD-Agent trace groups and local experiments, each row carrying its own backtest summary), and renders the selected item: RD-Agent traces get the summary, metrics, hypothesis, feedback, code, timeline, and stream views derived from `Message` tags, while a local run gets its card, metric series, run table, reports, and artifact list. The plugin holds no store and no projections — selection and polling interval are component-local, and the panel reaches the bridge by same-origin fetch.

Both packages are deliberately outside the session log and the model context: browsed traces never become model input, and nothing here registers a tool, a prompt section, or a session event.

## Alternatives considered

**Keep the Streamlit UI as the only reader.** It already renders the format correctly, but it costs a second server, a second theme, and a second place to authenticate for a surface that belongs beside the conversation it explains.

**Parse the pickles in Node.** A JavaScript reader would remove the Python child process and its interpreter coupling, but the format is RD-Agent's own domain objects; a second implementation would drift from `FileStorage` on every RD-Agent upgrade and could never reuse its tag taxonomy.

**Copy local experiment results into a DSH-owned store.** Projecting the `quant-experiment` tree into DSH would allow indexing and history, but it also creates a second copy whose staleness is invisible to the analysis that produced it. The bridge reads the tree in place and re-derives summaries on each request, with an mtime-keyed cache for the directory walk.

**Register the trace browser as a Settings section.** The settings shell is a configuration surface; traces are a working surface. A footer action with a drawer keeps the conversation, composer, and Session list visible while a run is inspected.

**Stream RD-Agent progress into the Session as events.** Live run monitoring would need durable event types, an authoritative producer, and a session-format decision for data no model ever reads; the bridge deliberately renders existing on-disk traces instead.

## Consequences

The integration is observational: DSH can read RD-Agent output but never starts, resumes, or writes a run, so nothing in the GUI can corrupt a trace directory. Fresh data costs a 30s poll and, for RD-Agent traces, one Python process per request — an explicit cost paid for exact tag parity with the Streamlit UI. The two-level tree conflates two sources into one browsing surface, which is what makes the local experiments usable at all, but it also means the panel must keep tolerating manifest variation; unmatched shapes degrade to pretty-printed JSON or to a row without a summary chip instead of failing the request. Neither package publishes an invariant companion: the bridge owns one route registration whose disposal is the fiber's own effect and exposes only per-request values, and the panel owns one slot registration with component-local state, so no independent observation can diverge from them; their READMEs record that reasoning. Route behavior is pinned by a real-composition spec that boots the plugin through the Loader with a stub `pythonBin`, and the panel by component specs plus a browser smoke against a live server.
