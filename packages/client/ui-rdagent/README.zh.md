# @deepseek-ai/dsh-client-ui-rdagent

[English](README.md) | 中文

RD-Agent 集成的浏览器半侧：一个 `sidebar.footer.action` 条目（侧边栏底部 Settings 旁的 **RD-Agent** 按钮）切换右侧**抽屉**，渲染 trace 浏览器。面板通过同源 fetch 读取 [`@deepseek-ai/dsh-rdagent-bridge`](../../rdagent/rdagent-bridge/README.md) 端点（`/rdagent/traces`、`/rdagent/trace`）——无 store、无投影、无事件监听；所有状态均为组件本地状态。抽屉可通过 Escape、点击遮罩或关闭按钮关闭。bridge 插件必须组合一个有效的 `logDir`；否则面板显示 bridge 的错误。

## 视图

- **回测指标**：头条徽章网格（年化收益、IR、最大回撤、均值——含成本）对比当前因子组合与 baseline，外加完整指标对比表；优于 baseline 的单元格为绿色。
- **研究假设**：将假设生成消息渲染为引用卡片。
- **实现评估反馈**：按轮次、按因子的判定卡片（✅/❌），带可折叠的执行／代码批评／值反馈分区。
- **因子实现代码**：将演进代码工作区的文件渲染为可折叠代码块。
- **流程时间线**：按 `Loop N · step` 分组、可折叠的消息时间线。
- **消息流**：带 tag 过滤的原始消息流。
- 选中 trace 后每 30s 轮询刷新。

## 模型体验

无。面板渲染 RD-Agent 自身磁盘上的日志，从不改动模型请求、工具执行或会话事件。

#### KV Cache 影响

无。

## 已知限制与暂缓事项

- **实时刷新依赖轮询**——30s 间隔，无 websocket 推送。
- **扁平指标提取**——对比表只展示第一条 runner-result 消息；跨 loop 的多轮累积留待后续。
- **通用内容渲染**——无法识别的对象以格式化 JSON 展示。
