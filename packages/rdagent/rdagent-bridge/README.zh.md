# @deepseek-ai/dsh-rdagent-bridge

[English](README.md) | 中文

宿主侧桥接插件，将 [RD-Agent](https://github.com/microsoft/RD-Agent) trace 日志提供给 DSH 浏览器插件。在 [`ctx.webServer`](../../host/webserver/README.md) 上注册 `/rdagent` 前缀路由，提供两个只读 GET 端点；pickle 格式的 RD-Agent `Message` 日志由运行 [`scripts/parse_trace.py`](scripts/parse_trace.py) 的 Python 子进程转换为 JSON，该脚本复用 `rdagent.log.storage.FileStorage`，因此 tag 与 Streamlit UI 完全一致。

## 配置

| 键 | 必填 | 默认值 | 含义 |
|---|---|---|---|
| `logDir` | 是 | — | 存放 RD-Agent trace 文件夹的根目录（例如 RD-Agent 检出目录下的 `log` 文件夹）。请求时缺失则响亮失败。 |
| `pythonBin` | 否 | `python` | 可导入 `rdagent` 的 Python 可执行文件；必须指向 RD-Agent 环境（Windows 上例如 `<RD-Agent>/.venv/Scripts/python.exe`）。 |
| `parseScript` | 否 | 打包的 `scripts/parse_trace.py` | 覆盖转换脚本。 |
| `experimentRoot` | 否 | — | 存放本地量化实验树（`experiments/<name>/`）的根目录。设置后 `/experiments` 路由提供统一实验树（RD-Agent 组 + 本地实验，只读）。 |

```yaml
plugins:
  - id: rdagent-bridge
    name: '@deepseek-ai/dsh-rdagent-bridge'
    config:
      logDir: '<RD-Agent>/log'
      pythonBin: '<RD-Agent>/.venv/Scripts/python.exe'
```

## 端点

- `GET /rdagent/traces` — `{ traces: [{ id, updatedAt, pklCount }] }`，最新的在前，不涉及 Python。
- `GET /rdagent/trace?id=<trace>&limit=<n>&tag=<substring>` — `{ trace, count, messages: [{ tag, timestamp, pid, content }] }`。`content` 尽力而为地序列化（标量原样、DataFrame 为 shape/columns/head、领域对象走友好属性、兜底 `str()`）。`id` 会做路径归一化并限制在 `logDir` 内；越界返回 400。

前缀刻意避开 `/api`（连接插件为信封协议持有该前缀）；这些是普通的同源数据端点。

## 模型体验

无。桥接从不改动模型请求、工具执行或会话事件，只把 RD-Agent 自身磁盘上的日志提供给浏览器。

#### KV Cache 影响

无。

## 已知限制与暂缓事项

- **一次一个 trace**——`trace` 只返回单个 trace 的消息；跨 trace 聚合留给客户端。
- **同步解析**——每次 `trace` 请求都会启动一个 Python 进程（完整运行需数秒）；暂无缓存或流式。
- **只读表面**——从 DSH 启动／监控 RD-Agent 运行不在范围内；桥接只渲染已有 trace。
- **`pythonBin` 必须匹配 RD-Agent 环境**——解释器不匹配时请求失败，并携带子进程 stderr。
