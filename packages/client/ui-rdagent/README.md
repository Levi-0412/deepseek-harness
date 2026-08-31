---
description: "Browse RD-Agent trace logs and local quant experiments inside the DSH Web GUI: a sidebar footer action opens a drawer with the experiment tree, backtest summaries, account curves, hypotheses, feedback, and artifacts."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-rdagent

English | [中文](README.zh.md)

## Summary

One **RD-Agent** action beside Settings at the sidebar foot opens a right-side drawer that browses what a quant run left on disk. The drawer lists one two-level tree over the bridge's `/experiments` route — RD-Agent trace groups and local experiment trees, each group row carrying its run count and backtest summary — and renders the selection: metric comparisons against the baseline, account curves, hypotheses, per-factor feedback, evolving code, the message timeline, and, for a local run, its metadata, series, reports, and artifacts. It reads [`@deepseek-ai/dsh-rdagent-bridge`](../../rdagent/rdagent-bridge/README.md) over same-origin fetch; all state is component-local.

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

Mount [`@deepseek-ai/dsh-rdagent-bridge`](../../rdagent/rdagent-bridge/README.md) with a valid `logDir` first, then add this row; the action toggles the drawer and the drawer reads the bridge's routes.

### When to choose it

Choose it when a deployment runs RD-Agent or keeps local quant experiments on disk and the people reading them already work in the DSH Web GUI: the drawer shows a run beside the conversation that explains it, instead of a second web application. Avoid it when the bridge is not mounted — the drawer then shows the bridge's error — or when traces are only ever consumed by automation.

### Minimal configuration

The package takes no `config:`. Add the row and it appears as a sidebar footer action:

```yaml
plugins:
  - id: ui-rdagent
    name: '@deepseek-ai/dsh-client-ui-rdagent'
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`apply` registers one `sidebar.footer.action` entry (`id: 'rdagent'`, `order: 10`, locale-following label) and its `rdagent` dictionary; the registered trigger owns the drawer, so the open state stays component-local. The drawer polls `/experiments` every 30 seconds, expands a group on click, and fetches detail once per selection: an RD-Agent trace becomes `{ trace, messages }` from `/rdagent/trace`, a local experiment becomes `series`, `reports`, `artifacts`, and — for a run row — that run's `meta` and `files` from `/experiments/run`. Nothing is cached between selections, so a re-selection re-reads the bridge.

RD-Agent views are derived from `Message` tags by the helpers in [`src/client/RdagentViews.tsx`](src/client/RdagentViews.tsx): the summary view folds hypothesis, factor, model, and verdict messages into one card, the metrics view compares runner-result metrics against `based_experiments`, and the account-curve view takes the last `Backtest` chart, compounding the benchmark's single-day-return column into cumulative returns. The local view renders the run card, the first derived metric series, a runs table labelled by design tag and seed, the artifacts, and collapsible reports.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@deepseek-ai/dsh-rdagent-bridge`](../../rdagent/rdagent-bridge/README.md) — the routes every view reads.
- [`@deepseek-ai/dsh-client-ui-sidebar`](../../client/ui-sidebar/README.md) — the sidebar whose footer action hosts the trigger.
- [`@deepseek-ai/dsh-client-ui-slots`](../../client/ui-slots/README.md) — the registration API and the `t` seat this plugin uses.
- [RD-Agent integration Agent Note](../../../.agents/notes/implemented/feature/2026-08-20-rdagent-trace-bridge-and-panel.md) — why the panel is a drawer over read-only routes.

-----

<a id="model-experience"></a>
## Model Experience

None, as the panel renders RD-Agent's and local experiments' own on-disk records and never alters model requests, tool execution, or session events.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

Everything here is read-only and browser-local; the gaps below cost review convenience, never model context.

- **Live refresh is polling** — a 30s interval with no push channel, so a run in progress appears up to one interval late.
- **Flat metric extraction** — the comparison table shows the first runner-result message; accumulating across loops is future work.
- **Generic content rendering** — an unrecognized trace object or local file shape degrades to pretty-printed JSON instead of a dedicated view.
- **Detail is fetched once per selection** — switching away and back re-reads the bridge, and a slow RD-Agent parse blocks the drawer's detail pane.
- **Only the first derived series is charted** — a local experiment with several metric files shows one curve.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The feature decision, the rejected alternatives, and the required verification are recorded in the [RD-Agent integration Agent Note](../../../.agents/notes/implemented/feature/2026-08-20-rdagent-trace-bridge-and-panel.md). Behavior is pinned by [`tests/panel.client.spec.tsx`](tests/panel.client.spec.tsx), which drives the panel against a stub fetch.

</details>

**Runtime invariant:** No companion is published. The plugin owns one slot registration and one dictionary registration, both released by the plugin fiber's effects, and every other value it holds is component-local; no independent observation can diverge from that pair.
