---
description: "Browse RD-Agent trace logs and local quant experiments inside the DSH Web GUI: a sidebar footer action opens a drawer with the experiment tree, backtest summaries, account curves, hypotheses, feedback, and artifacts."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-rdagent

[English](README.md) | 中文

## 概述

侧边栏底部紧邻 Settings 的一个 **RD-Agent** 入口会打开右侧抽屉，用于浏览一次量化运行留在磁盘上的记录。抽屉以 bridge 的 `/experiments` 路由渲染一棵两级树——RD-Agent trace 分组与本地实验树，每个分组行带运行数与回测摘要——并渲染所选项：与 baseline 对比的指标、账户轨迹、研究假设、按因子的实现评估反馈、演进代码、消息时间线；若是本地运行，还有它的元数据、指标序列、报告与产物。数据通过同源 fetch 读取 [`@deepseek-ai/dsh-rdagent-bridge`](../../rdagent/rdagent-bridge/README.zh.md)；所有状态均为组件本地状态。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

先以有效的 `logDir` 挂载 [`@deepseek-ai/dsh-rdagent-bridge`](../../rdagent/rdagent-bridge/README.zh.md)，再加入本行；入口用于开关抽屉，抽屉读取 bridge 的路由。

### 何时选择它

当部署会运行 RD-Agent，或在磁盘上保留本地量化实验，而阅读这些记录的人本来就在 DSH Web GUI 中工作时，选择本包：抽屉把一次运行放在解释它的对话旁边，而不必再开一个 Web 应用。bridge 未挂载时不必选择本包——此时抽屉会显示 bridge 的错误；trace 只由自动化消费时同理。

### 最小配置

本包不接受 `config:`。加入该行即可，它会以侧边栏页脚入口的形式出现：

```yaml
plugins:
  - id: ui-rdagent
    name: '@deepseek-ai/dsh-client-ui-rdagent'
```

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`apply` 注册一个 `sidebar.footer.action` 条目（`id: 'rdagent'`、`order: 10`、随语言环境解析的 label）以及 `rdagent` 词典；被注册的触发组件持有抽屉，因此开启状态始终是组件本地状态。抽屉每 30 秒轮询一次 `/experiments`，点击展开分组，并在每次选中时拉取一次详情：RD-Agent trace 从 `/rdagent/trace` 得到 `{ trace, messages }`；本地实验从 `/experiments/run` 得到 `series`、`reports`、`artifacts`，若是运行行还包括该运行的 `meta` 与 `files`。选中项之间不缓存，因此重新选中会重新读取 bridge。

RD-Agent 的各个视图由 [`src/client/RdagentViews.tsx`](src/client/RdagentViews.tsx) 中的辅助函数从 `Message` tag 派生：摘要视图把假设、因子、模型与判定消息折叠成一张卡片，指标视图把 runner-result 指标与 `based_experiments` 对比，账户轨迹视图取最后一张 `Backtest` 图，并把基准的单日收益列复利成累计收益。本地视图渲染运行卡片、第一条派生出的指标序列、以设计变体 tag 与 seed 标注的运行表、产物列表，以及可折叠报告。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@deepseek-ai/dsh-rdagent-bridge`](../../rdagent/rdagent-bridge/README.zh.md)——所有视图读取的路由。
- [`@deepseek-ai/dsh-client-ui-sidebar`](../../client/ui-sidebar/README.zh.md)——页脚入口所在的侧边栏。
- [`@deepseek-ai/dsh-client-ui-slots`](../../client/ui-slots/README.zh.md)——本插件使用的注册 API 与 `t` 座位。
- [RD-Agent 集成 Agent Note](../../../.agents/notes/implemented/feature/2026-08-20-rdagent-trace-bridge-and-panel.zh.md)——为什么面板是只读路由之上的抽屉。

-----

<a id="model-experience"></a>
## 模型体验

无。面板渲染 RD-Agent 与本地实验自身磁盘上的记录，从不改动模型请求、工具执行或会话事件。

#### KV Cache 影响

无。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这里的一切都是只读且浏览器本地的；下列缺口只影响查阅便利性，不会影响模型上下文。

- **实时刷新依赖轮询**——30 秒间隔，无推送通道，因此进行中的运行最多滞后一个间隔出现。
- **扁平指标提取**——对比表只展示第一条 runner-result 消息；跨 loop 的多轮累积留待后续。
- **通用内容渲染**——无法识别的 trace 对象或本地文件形状会降级为格式化 JSON，而不是专用视图。
- **详情每次选中只拉取一次**——切走再切回会重新读取 bridge，且 RD-Agent 解析较慢时会阻塞抽屉的详情区。
- **只绘制第一条派生序列**——拥有多个指标文件的本地实验只显示一条曲线。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

功能决策、被否决的方案与所需的验证记录在 [RD-Agent 集成 Agent Note](../../../.agents/notes/implemented/feature/2026-08-20-rdagent-trace-bridge-and-panel.zh.md)。行为由 [`tests/panel.client.spec.tsx`](tests/panel.client.spec.tsx) 固定——它用桩 fetch 驱动面板。

</details>

**Runtime invariant:** No companion is published. 本插件持有一个 slot 注册与一个词典注册，二者都由插件 fiber 的效果释放，其余值均为组件本地状态；不存在可能与这一对产生分歧的独立观测。
