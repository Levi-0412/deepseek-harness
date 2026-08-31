# Agent Note: RD-Agent trace bridge and experiment panel

Status: implemented

[English](2026-08-20-rdagent-trace-bridge-and-panel.md) | 中文

## Problem

一次 [RD-Agent](https://github.com/microsoft/RD-Agent) 量化运行会把它知道的一切写进一个按运行划分的 trace 目录，内容是一系列 pickle 序列化的 `Message` 对象，位于 `<RD-Agent>/log` 下；而这个格式唯一的读取方是 RD-Agent 自带的 Streamlit UI。因此要从 DSH Web GUI 里回顾一轮因子研究循环，只能在旁边再跑一个 Web 应用，或者为每个问题手写脚本；两者都无法复用本 GUI 的主题、会话上下文与鉴权。兄弟项目 `quant-experiment` 写出的本地量化实验则相反：JSON 清单小到任何文本编辑器都能打开，却没有任何视角能横向比较多次运行，或看出一次运行的产物放在哪里。

## Decision

集成由两个包承担，每个平面一个。

[`@deepseek-ai/dsh-rdagent-bridge`](../../../../packages/rdagent/rdagent-bridge/README.zh.md) 是 Host 侧插件，在 `ctx.webServer` 上注册两个前缀路由：`/rdagent` 服务 pickle 化的 RD-Agent 日志，`/experiments` 服务本地实验树。`logDir`、`pythonBin`、`parseScript`、`experimentRoot` 都是经校验的 `Config` 字段，部署方在 `cordis.yml` 里把自己的 checkout 指向它们，随包发布的这一行在未设置 `DSH_RDAGENT_LOGDIR` 前保持禁用。pickle 日志端点通过 `pythonBin` 启动随包发布的 [`scripts/parse_trace.py`](../../../../packages/rdagent/rdagent-bridge/scripts/parse_trace.py)，并把它的 JSON 输出转发出去；该脚本复用 `rdagent.log.storage.FileStorage`，因此 tag、顺序与消息内容与生成这些日志的 Streamlit UI 一致，而不是重新实现一遍 pickle 格式。本地实验端点则在进程内解析清单与指标文件（[`src/local.ts`](../../../../packages/rdagent/rdagent-bridge/src/local.ts)），兼容该项目产出的三种 series 布局（mapping、columnar、裸数组）与两种清单编码（JSON 与 JSON Lines），并读取 Windows 工具链留下的 UTF-16LE 与 GB18030 文本。所有路由都是只读的：路径会被规范化并限制在各自配置的根目录内，越界请求返回 400。

[`@deepseek-ai/dsh-client-ui-rdagent`](../../../../packages/client/ui-rdagent/README.zh.md) 是浏览器半侧：侧边栏页脚紧邻 Settings 的一个 `sidebar.footer.action` 入口，用于开关右侧抽屉。抽屉以 `/experiments` 为数据源渲染一棵两级树（RD-Agent trace 分组与本地实验，每行各自带回测摘要），并渲染所选项：RD-Agent trace 得到由 `Message` tag 派生的摘要、指标、研究假设、实现评估反馈、代码、时间线与消息流视图，本地运行则得到自己的运行卡片、指标曲线、运行表、报告与产物列表。该插件不持有 store，也不注册投影——选中项与轮询间隔都是组件内状态，面板通过同源 fetch 访问 bridge。

两个包都刻意位于会话日志与模型上下文之外：被浏览的 trace 永远不会成为模型输入，这里也没有注册任何工具、提示词区段或会话事件。

## Alternatives considered

**继续把 Streamlit UI 当作唯一读取方。** 它确实能正确渲染该格式，但代价是：为了一块本该紧挨着它所解释的对话而存在的界面，额外运行一个服务、额外维护一套主题、额外提供一个鉴权入口。

**在 Node 里解析 pickle。** 纯 JavaScript 读取器可以去掉 Python 子进程及其解释器耦合，但这个格式就是 RD-Agent 自己的领域对象；第二份实现会在每次 RD-Agent 升级时与 `FileStorage` 产生偏差，且永远无法复用它的 tag 体系。

**把本地实验结果拷进 DSH 自有的存储。** 把 `quant-experiment` 树投影进 DSH 可以换来索引与历史记录，但也会制造第二份副本，而它的过期与否对产出这些结果的分析过程是不可见的。bridge 改为就地读取该树，每次请求重新推导摘要，目录遍历用基于 mtime 的缓存加速。

**把 trace 浏览器注册成 Settings 区段。** Settings 是配置界面，trace 是工作界面。页脚入口加抽屉的形式让对话、输入区与会话列表在检查一次运行时依然可见。

**把 RD-Agent 进度作为事件流进 Session。** 实时监控需要持久事件类型、权威生产者，以及为「模型根本不会读的数据」做一次会话格式决策；bridge 刻意只渲染磁盘上已有的 trace。

## Consequences

这套集成是观察性的：DSH 能读 RD-Agent 的输出，但永远不会启动、恢复或写入一次运行，因此 GUI 里没有任何操作能破坏 trace 目录。获取新数据的代价是 30 秒轮询，以及对 RD-Agent trace 的每次请求一个 Python 进程——这是为与 Streamlit UI 完全一致的 tag 语义付出的显式成本。两级树把两个来源合并进同一个浏览界面，这正是本地实验变得可用的原因，但也意味着面板必须持续容忍清单的差异；无法识别的形状会降级为格式化 JSON 或一个没有摘要标签的行，而不是让请求失败。两个包都不发布不变式伴随插件：bridge 只持有一个路由注册，其释放就是 fiber 自身的效果，对外只暴露逐次请求的值；面板只持有一个 slot 注册与组件内状态，因此不存在可能与它们产生分歧的独立观测；各自的 README 记录了这条推理。路由行为由真实组合的 spec 固定——它通过 Loader 启动该插件并使用桩 `pythonBin`；面板则由组件 spec 加针对真实服务器的浏览器冒烟测试固定。
