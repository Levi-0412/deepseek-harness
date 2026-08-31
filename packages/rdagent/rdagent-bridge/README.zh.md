---
description: "Serve RD-Agent trace logs and local quant-experiment trees to DSH Web surfaces over two read-only HTTP prefixes, converting pickled RD-Agent messages with the RD-Agent environment's own storage layer."
kind: "package-reference"
---

# @deepseek-ai/dsh-rdagent-bridge

[English](README.md) | 中文

## 概述

挂载本插件，即可在 DSH Web GUI 中浏览一次量化运行留在磁盘上的记录：`logDir` 下的 RD-Agent trace 目录，以及 `experimentRoot` 下的本地实验树。它在 `ctx.webServer` 上注册只读的 `/rdagent` 与 `/experiments` 前缀；pickle 化的 RD-Agent 消息由 `pythonBin` 运行随包发布的 `scripts/parse_trace.py` 转换，因此 tag 与内容同 RD-Agent Streamlit UI 一致，本地清单、指标文件与产物则在进程内解析。每次 trace 请求的代价是一个 Python 进程。这里没有任何内容进入模型请求或会话日志。

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

挂载该行并把 `logDir` 指向 RD-Agent checkout 的 `log` 目录，再搭配 [`@deepseek-ai/dsh-client-ui-rdagent`](../../client/ui-rdagent/README.zh.md)——即渲染这些路由应答内容的浏览器面板。

### 何时选择它

当部署已经在产出 RD-Agent trace，或本地 `quant-experiment` 树，且希望 Web 界面能在对话旁边读取它们时，选择本包。主机上没有任何进程产出这些格式时则不必：既无 `logDir` 也无实验时路由只会返回空列表，而且随包发布的 Web 行在设置 `DSH_RDAGENT_LOGDIR` 之前一直保持禁用。bridge 在两个方向上都是只读的——它从不启动、恢复或写入一次 RD-Agent 运行。

### 最小配置

```yaml
plugins:
  - id: rdagent-bridge
    name: '@deepseek-ai/dsh-rdagent-bridge'
    config:
      logDir: '<RD-Agent>/log'
      pythonBin: '<RD-Agent>/.venv/Scripts/python.exe'
      experimentRoot: '<project>/experiments'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `logDir` | 必填 | 存放 RD-Agent trace 目录的根目录。目录缺失时读取它的请求会失败。 |
| `pythonBin` | `python` | 能 import `rdagent` 的 Python 可执行文件；必须与产出这些 trace 的环境一致。 |
| `parseScript` | 随包发布的 `scripts/parse_trace.py` | 转换脚本覆盖项。 |
| `experimentRoot` | 无 | 存放本地实验树（`experiments/<name>/`）的根目录；为空则不注册 `/experiments`。 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-rdagent-bridge)是全部可接受字段的完整来源。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`apply` 在加载时解析一次 `logDir` 与 `experimentRoot`，并通过 `ctx.webServer.register({ kind: 'prefix', … })` 注册路由前缀，返回合并后的 disposer，因此这些路由的生命周期恰好与插件 fiber 相同。两个前缀共用一个处理函数：除 `GET` 之外的请求一律返回 `405`，抛出的错误转成 `500`（面板会展示其中的消息），其余异常输入返回 `400`。

| 路由 | 应答 |
|---|---|
| `GET /rdagent/traces` | `{ traces: [{ id, updatedAt, pklCount }] }`，按新到旧排序，不涉及 Python。trace id 可以是一段或两段路径（`<时间戳>` 或 `<实验>/<时间戳>`）。 |
| `GET /rdagent/trace?id=&limit=&tag=` | 转换后的 trace：`{ trace, count, messages: [{ tag, timestamp, pid, content }] }`。`limit` 默认 2000，`tag` 按子串过滤。 |
| `GET /experiments` | `{ experiments: [{ name, source, runs, artifacts, warnings?, summary? }] }`，先是 RD-Agent 分组（每个 trace 子目录一组，根目录下的 trace 归入 `未分组`），然后是本地实验。 |
| `GET /experiments/run?exp=&run=` | 该实验的 `runs`、`artifacts`、`warnings`、推导出的 `series`、最多三份文本 `reports`；当 `run` 命中已知运行 id 时，还包括该运行的 `meta` 与递归 `files`。 |
| `GET /experiments/artifact?exp=&path=` | `{ exp, path, text }`，即某个产物的解码内容（上限 100 KB）。 |

pickle 日志这条路径会用 `pythonBin` 启动 [`scripts/parse_trace.py`](scripts/parse_trace.py)，传入 `logDir` 与 trace id，并把它的 stdout 解析为 JSON；该脚本 import 了 `rdagent.log.storage.FileStorage`，因此 tag、顺序与消息内容都来自 RD-Agent 自己的读取器。子进程的 `LOG_TRACE_PATH` 被重定向到操作系统临时目录，因为 import `rdagent` 本身就会新建一个 trace 目录。本地那条路径是纯 TypeScript，位于 [`src/local.ts`](src/local.ts)：清单先按 JSON 读取，失败后再按 JSON Lines 读取；指标文件按 mapping、columnar 或裸数组三种 series 布局解析；文本文件依次按 UTF-16LE／UTF-16BE 字节序标记、严格 UTF-8、GB18030 解码。目录遍历按修改时间缓存，所有路径都会针对各自配置的根目录解析并施加段数与深度限制，因此 `exp` 与 `path` 无法越界。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@deepseek-ai/dsh-client-ui-rdagent`](../../client/ui-rdagent/README.zh.md)——渲染这些路由的面板。
- [`@deepseek-ai/dsh-host-webserver`](../../host/webserver/README.zh.md)——这些前缀注册所在的 HTTP 载体。
- [配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-rdagent-bridge)——由源码生成的完整配置字段。
- [RD-Agent 集成 Agent Note](../../../.agents/notes/implemented/feature/2026-08-20-rdagent-trace-bridge-and-panel.zh.md)——为什么由 RD-Agent 自己的环境解析 pickle，以及被否决的方案。

-----

<a id="model-experience"></a>
## 模型体验

无。bridge 从不改动模型请求、工具执行或会话事件；它只把 RD-Agent 与本地实验自身磁盘上的记录提供给浏览器。

#### KV Cache 影响

无。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

该界面是只读且逐次请求的；这些限制的代价是延迟与跨运行分析能力，而不会产生模型可见的影响。

- **一次一个 trace**——`/rdagent/trace` 只返回单个 trace 的消息；跨 trace 聚合留给客户端。
- **同步解析**——每次 RD-Agent trace 请求都会启动一个 Python 进程（完整运行需数秒）；没有缓存、没有流式输出，也不支持取消进行中的子进程。
- **只读界面**——从 DSH 启动、恢复或监控 RD-Agent 运行不在范围内；bridge 只渲染已有 trace。
- **`pythonBin` 必须匹配 RD-Agent 环境**——解释器不匹配时请求会带着子进程的 stderr 失败，且事先没有任何检测。
- **容忍清单差异而非校验**——本地实验的文件若不属于任何已识别的布局，会降级为一个没有摘要标签的行或格式化 JSON，而不是显式失败。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

功能决策、被否决的方案与所需的验证记录在 [RD-Agent 集成 Agent Note](../../../.agents/notes/implemented/feature/2026-08-20-rdagent-trace-bridge-and-panel.zh.md)。路由行为由 [`tests/route.spec.ts`](tests/route.spec.ts) 固定——它通过 Loader 启动本插件，并用桩 `pythonBin` 作答。

</details>

**Runtime invariant:** No companion is published. 本插件为每个前缀持有一个路由注册，其释放就是插件 fiber 自身的效果，而它产出的其他值都是逐次请求生成的；不存在可能与这一对产生分歧的独立观测。
