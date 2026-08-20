# @deepseek-ai/dsh-client-ui-rdagent

English | [中文](README.zh.md)

Browser half of the RD-Agent integration: one `sidebar.footer.action` entry (the **RD-Agent** button beside Settings at the sidebar foot) that toggles a right-side **drawer** rendering the trace browser. The panel reads [`@deepseek-ai/dsh-rdagent-bridge`](../../rdagent/rdagent-bridge/README.md) endpoints (`/rdagent/traces`, `/rdagent/trace`) over same-origin fetch — no store, no projections, no event listeners; all state is component-local. The drawer closes on Escape, backdrop click, or its close button. The bridge plugin must be composed with a valid `logDir`; without it the panel shows the bridge's error.

## Views

- **回测指标 (metrics)**: headline badge grid (annualized return, IR, max drawdown, mean — with cost) comparing the current factor combination against the baseline, plus a full metric comparison table; cells better than baseline are green.
- **研究假设 (hypotheses)**: hypothesis-generation messages as quote cards.
- **实现评估反馈 (feedback)**: per-round per-factor verdict cards (✅/❌) with collapsible execution / code-critique / value feedback sections.
- **因子实现代码 (code)**: evolving-code workspaces' files as collapsible code blocks.
- **流程时间线 (timeline)**: messages grouped by `Loop N · step`, collapsible.
- **消息流 (stream)**: the raw tag-filtered message stream.
- 30s polling refresh while a trace is selected.

## Model Experience

None, as the panel renders RD-Agent's own on-disk logs and never alters model requests, tool execution, or session events.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- **Live refresh is polling** — 30s interval, no websocket push.
- **Flat metric extraction** — the comparison table shows the first runner-result message; multi-loop accumulation across loops is future work.
- **Generic content rendering** — unrecognized objects display as pretty-printed JSON.
