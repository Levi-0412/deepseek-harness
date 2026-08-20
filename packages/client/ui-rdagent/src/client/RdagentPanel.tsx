/**
 * RD-Agent trace panel content: trace picker plus structured views rendered
 * inside the drawer. Reads `dsh-rdagent-bridge` endpoints over same-origin
 * fetch; all state is component-local. Views: backtest metric comparison
 * (badge grid + table), hypotheses, per-task feedback, factor code, and a
 * loop-grouped timeline, with 30s polling while a trace is selected.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  EquityView,
  LocalRunView,
  SummaryView,
  type ExperimentData,
  type ExperimentGroup,
  type LocalExperimentDetail,
} from './RdagentViews.tsx'
import styles from './RdagentPanel.module.css'

/** One trace directory under the bridge's logDir. */
export interface TraceSummary {
  id: string
  updatedAt: string
  pklCount: number
}

/** One converted RD-Agent log message. */
export interface TraceMessage {
  tag: string
  timestamp: string
  pid: string
  content: unknown
}

/** Full bridge response for one trace. */
export interface TraceData {
  trace: string
  count: number
  messages: TraceMessage[]
}

/** One backtest metric series: values keyed by dotted metric name. */
export interface MetricSeries {
  type?: string
  values?: Record<string, number | null>
}

/** One per-task feedback record. */
export interface FeedbackRecord {
  type?: string
  execution_feedback?: string
  code_feedback?: string
  value_feedback?: string
  final_feedback?: string
  final_decision?: boolean
  value_generated_flag?: boolean
}

const TRACE_URL = '/rdagent/trace'
const EXPERIMENTS_URL = '/experiments'
const EXPERIMENT_RUN_URL = '/experiments/run'
const REFRESH_MS = 30000

/** Unified tree selection: an RD-Agent trace or a local experiment. */
export type Selection = { source: 'rdagent'; traceId: string } | { source: 'local'; exp: string } | null

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (typeof body.error === 'string') detail += `: ${body.error}`
    } catch {
      // non-JSON error body: keep the status-only message
    }
    throw new Error(detail)
  }
  return (await res.json()) as T
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

/** Pretty-print a dotted metric name (e.g. `..._with_cost.annualized_return` → `annualized return`). */
function metricLabel(key: string): string {
  const parts = key.split('.')
  return (parts[parts.length - 1] ?? key).replace(/_/g, ' ')
}

function metricScope(key: string): string {
  const parts = key.split('.')
  return parts.length >= 2 ? (parts[parts.length - 2] ?? '').replace(/_/g, ' ') : ''
}

function fmtNum(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  if (Math.abs(v) >= 100) return v.toFixed(1)
  if (Math.abs(v) >= 1) return v.toFixed(3)
  return v.toFixed(4)
}

/* ── Structured extraction ─────────────────────────────────────────────── */

function isMetricSeries(content: unknown): content is { type?: string; values?: unknown } {
  return typeof content === 'object' && content !== null && 'values' in content && 'type' in content
}

export function pickMetrics(content: unknown): MetricSeries | null {
  if (!isMetricSeries(content)) return null
  const values = content.values
  if (typeof values !== 'object' || values === null) return null
  const out: Record<string, number | null> = {}
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === 'number') out[k] = v
  }
  return Object.keys(out).length > 0 ? { values: out } : null
}

function experimentOf(content: unknown): { result?: MetricSeries | null; baselines: MetricSeries[] } | null {
  if (typeof content !== 'object' || content === null) return null
  const c = content as Record<string, unknown>
  if (!('result' in c) || !('based_experiments' in c)) return null
  const baselines: MetricSeries[] = []
  if (Array.isArray(c.based_experiments)) {
    for (const b of c.based_experiments) {
      const m = pickMetrics(b)
      if (m !== null) baselines.push(m)
    }
  }
  return { result: pickMetrics(c.result), baselines }
}

function feedbackListOf(content: unknown): FeedbackRecord[] | null {
  if (typeof content !== 'object' || content === null) return null
  const c = content as Record<string, unknown>
  if (!Array.isArray(c.feedback_list)) return null
  return c.feedback_list.filter((f): f is FeedbackRecord => typeof f === 'object' && f !== null)
}

function codeFilesOf(content: unknown): { files: Record<string, string> }[] {
  const out: { files: Record<string, string> }[] = []
  const collect = (c: unknown): void => {
    if (Array.isArray(c)) {
      c.forEach(collect)
      return
    }
    if (typeof c !== 'object' || c === null) return
    const rec = c as Record<string, unknown>
    if (typeof rec.files === 'object' && rec.files !== null) {
      out.push({ files: rec.files as Record<string, string> })
    }
  }
  collect(content)
  return out
}

/* ── Views ─────────────────────────────────────────────────────────────── */

/** Highlighted metrics: annualized return, IR, max drawdown, mean (with cost). */
const HEADLINE_KEYS = [
  '1day.excess_return_with_cost.annualized_return',
  '1day.excess_return_with_cost.information_ratio',
  '1day.excess_return_with_cost.max_drawdown',
  '1day.excess_return_with_cost.mean',
]

function MetricsView({ messages }: { messages: TraceMessage[] }) {
  const exp = useMemo(() => {
    for (const m of messages) {
      if (!m.tag.includes('runner result')) continue
      const e = experimentOf(m.content)
      if (e !== null) return e
    }
    return null
  }, [messages])

  if (exp === null) return null
  const current = exp.result?.values ?? {}
  const baseline = exp.baselines[0]?.values ?? {}

  const headline = HEADLINE_KEYS.map((key) => {
    const cur = current[key] ?? null
    const base = baseline[key] ?? null
    const better = cur !== null && base !== null && cur > base
    const worse = cur !== null && base !== null && cur < base
    return { key, label: metricLabel(key), scope: metricScope(key), cur, base, better, worse }
  })

  const allKeys = new Set([...Object.keys(current), ...Object.keys(baseline)])
  const table = [...allKeys].map(key => ({
    key,
    label: metricLabel(key),
    scope: metricScope(key),
    cur: current[key] ?? null,
    base: baseline[key] ?? null,
  }))

  return (
    <section className={styles.card}>
      <h3 className={styles.cardTitle}>回测指标</h3>
      <div className={styles.badgeGrid}>
        {headline.map(h => (
          <div key={h.key} className={`${styles.badge} ${h.better ? styles.badgeBetter : h.worse ? styles.badgeWorse : ''}`}>
            <span className={styles.badgeValue}>{fmtNum(h.cur)}</span>
            <span className={styles.badgeLabel}>{h.label}</span>
            <span className={styles.badgeMeta}>
              baseline {fmtNum(h.base)} · {h.scope}
            </span>
          </div>
        ))}
      </div>
      <details className={styles.tableWrap}>
        <summary>全部指标对比</summary>
        <table className={styles.metricsTable}>
          <thead>
            <tr><th>指标</th><th>范围</th><th>当前</th><th>Baseline</th></tr>
          </thead>
          <tbody>
            {table.map(r => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td className={styles.muted}>{r.scope}</td>
                <td className={r.cur !== null && r.base !== null && r.cur > r.base ? styles.better : undefined}>{fmtNum(r.cur)}</td>
                <td>{fmtNum(r.base)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  )
}

function CodeView({ messages }: { messages: TraceMessage[] }) {
  const files = useMemo(() => {
    const out: { tag: string; files: Record<string, string> }[] = []
    for (const m of messages) {
      if (!m.tag.includes('evolving code')) continue
      for (const cf of codeFilesOf(m.content)) {
        if (Object.keys(cf.files).length > 0) out.push({ tag: m.tag, files: cf.files })
      }
    }
    return out
  }, [messages])
  if (files.length === 0) return null
  return (
    <section className={styles.card}>
      <h3 className={styles.cardTitle}>因子实现代码</h3>
      {files.map((f, i) => (
        <div key={i} className={styles.codeBlock}>
          <div className={styles.codeHeader}>
            <code>{f.tag}</code>
            <span className={styles.muted}>{Object.keys(f.files).join(', ')}</span>
          </div>
          {Object.entries(f.files).map(([name, code]) => (
            <details key={name} open={i === 0}>
              <summary>{name}</summary>
              <pre className={styles.code}>{code}</pre>
            </details>
          ))}
        </div>
      ))}
    </section>
  )
}

function FeedbackView({ messages }: { messages: TraceMessage[] }) {
  const rounds = useMemo(() => {
    const out: { tag: string; list: FeedbackRecord[] }[] = []
    for (const m of messages) {
      if (!m.tag.includes('evolving feedback')) continue
      const list = feedbackListOf(m.content)
      if (list !== null && list.length > 0) out.push({ tag: m.tag, list })
    }
    return out
  }, [messages])
  if (rounds.length === 0) return null
  return (
    <section className={styles.card}>
      <h3 className={styles.cardTitle}>实现评估反馈</h3>
      {rounds.map((r, i) => (
        <details key={`${r.tag}-${i}`} open={i === 0}>
          <summary>
            <code>{r.tag}</code> · {r.list.length} 个因子
          </summary>
          <div className={styles.feedbackGrid}>
            {r.list.map((f, j) => (
              <div key={j} className={`${styles.feedback} ${f.final_decision ? styles.feedbackPass : styles.feedbackFail}`}>
                <div className={styles.feedbackHeader}>
                  <span className={f.final_decision ? styles.verdictPass : styles.verdictFail}>
                    {f.final_decision ? '通过' : '未通过'}
                  </span>
                  {f.value_generated_flag !== undefined && (
                    <span className={styles.muted}>值生成 {String(f.value_generated_flag)}</span>
                  )}
                </div>
                {f.final_feedback !== undefined && <p className={styles.feedbackText}>{f.final_feedback}</p>}
                {f.execution_feedback !== undefined && (
                  <details><summary>执行反馈</summary><pre className={styles.feedbackPre}>{f.execution_feedback}</pre></details>
                )}
                {f.code_feedback !== undefined && (
                  <details><summary>代码批评</summary><pre className={styles.feedbackPre}>{f.code_feedback}</pre></details>
                )}
                {f.value_feedback !== undefined && (
                  <details><summary>值反馈</summary><pre className={styles.feedbackPre}>{f.value_feedback}</pre></details>
                )}
              </div>
            ))}
          </div>
        </details>
      ))}
    </section>
  )
}

function TimelineView({ messages, filter }: { messages: TraceMessage[]; filter: string }) {
  const groups = useMemo(() => {
    const map = new Map<string, TraceMessage[]>()
    for (const m of messages) {
      if (filter !== '' && !m.tag.includes(filter)) continue
      const loop = /Loop_(\d+)/.exec(m.tag)
      const step = /(?:\.|^)(direct_exp_gen|coding|running|feedback|record)/.exec(m.tag)
      const key = loop !== null ? `Loop ${loop[1]} · ${step?.[1] ?? 'misc'}` : '初始化'
      const list = map.get(key)
      if (list !== undefined) list.push(m)
      else map.set(key, [m])
    }
    return [...map.entries()]
  }, [messages, filter])
  if (groups.length === 0) return null
  return (
    <section className={styles.card}>
      <h3 className={styles.cardTitle}>流程时间线</h3>
      <div className={styles.timeline}>
        {groups.map(([key, list]) => (
          <details key={key} open={key.startsWith('Loop 0')} className={styles.timelineGroup}>
            <summary className={styles.timelineHeader}>
              <span className={styles.timelineDot} />
              <span>{key}</span>
              <span className={styles.muted}>{list.length} 条</span>
            </summary>
            {list.map((m, i) => (
              <div key={`${m.timestamp}-${i}`} className={styles.message}>
                <div className={styles.messageHeader}>
                  <code className={styles.tag}>{m.tag}</code>
                  <span className={styles.time}>{formatTime(m.timestamp)}</span>
                </div>
                <ContentView content={m.content} />
              </div>
            ))}
          </details>
        ))}
      </div>
    </section>
  )
}

function ContentView({ content }: { content: unknown }) {
  if (typeof content === 'string') {
    return <pre className={styles.text}>{content}</pre>
  }
  if (content === null || content === undefined) {
    return <span className={styles.muted}>∅</span>
  }
  return <pre className={styles.json}>{JSON.stringify(content, null, 2)}</pre>
}

/**
 * The RD-Agent trace panel content (rendered inside the drawer).
 * @param props - close callback owned by the trigger that hosts the drawer.
 */
export function RdagentPanel({ onClose }: { onClose: () => void }) {
  const [groups, setGroups] = useState<ExperimentGroup[] | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selection, setSelection] = useState<Selection>(null)
  const [error, setError] = useState<string>('')
  const [data, setData] = useState<TraceData | null>(null)
  const [localDetail, setLocalDetail] = useState<LocalExperimentDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [tagFilter, setTagFilter] = useState('')
  const [view, setView] = useState<'overview' | 'equity' | 'stream'>('overview')

  // Unified experiment tree, refreshed on the polling interval.
  useEffect(() => {
    let alive = true
    const load = (): void => {
      fetchJson<ExperimentData>(EXPERIMENTS_URL)
        .then((d) => {
          if (alive) setGroups(d.experiments)
        })
        .catch((e: unknown) => {
          if (alive) setError(e instanceof Error ? e.message : String(e))
        })
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  const loadTrace = useCallback((id: string) => {
    setLoading(true)
    setError('')
    fetchJson<TraceData>(`${TRACE_URL}?id=${encodeURIComponent(id)}&limit=2000`)
      .then((d) => { setData(d) })
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { setLoading(false) })
  }, [])

  // RD-Agent trace detail with 30s polling; local selections never hit /rdagent/trace.
  useEffect(() => {
    if (selection === null || selection.source !== 'rdagent') {
      setData(null)
      return
    }
    const id = selection.traceId
    loadTrace(id)
    const timer = setInterval(() => { loadTrace(id) }, REFRESH_MS)
    return () => { clearInterval(timer) }
  }, [selection, loadTrace])

  // Local experiment detail, fetched once per selection.
  useEffect(() => {
    if (selection === null || selection.source !== 'local') {
      setLocalDetail(null)
      return
    }
    let alive = true
    setLoading(true)
    setError('')
    fetchJson<LocalExperimentDetail>(`${EXPERIMENT_RUN_URL}?exp=${encodeURIComponent(selection.exp)}`)
      .then((d) => {
        if (alive) setLocalDetail(d)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [selection])

  const selectRun = (source: 'rdagent' | 'local', id: string): void => {
    setView('overview')
    setTagFilter('')
    setError('')
    setData(null)
    setLocalDetail(null)
    setSelection(source === 'rdagent' ? { source: 'rdagent', traceId: id } : { source: 'local', exp: id })
  }

  const toggleGroup = (name: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <span className={styles.title}>RD-Agent Traces</span>
        <span className={styles.muted}>{loading ? '加载中…' : data !== null ? `${data.count} 条消息` : ''}</span>
        <button type="button" onClick={onClose} className={styles.close} aria-label="关闭">✕</button>
      </div>
      {error !== '' && <div className={styles.error}>bridge error: {error}</div>}
      <div className={styles.body}>
        <aside className={styles.side}>
          {groups === null ? (
            <div className={styles.muted}>loading experiments…</div>
          ) : groups.length === 0 ? (
            <div className={styles.muted}>no experiments found</div>
          ) : (
            <ul className={styles.traceList}>
              {groups.map(g => (
                <li key={`${g.source}:${g.name}`}>
                  <button
                    type="button"
                    className={styles.groupRow}
                    onClick={() => {
                      toggleGroup(g.name)
                      // run-less local experiments select on the group row itself
                      if (g.source === 'local' && g.runs.length === 0) selectRun('local', g.name)
                    }}
                  >
                    <span className={styles.groupCaret}>{expanded.has(g.name) ? '▾' : '▸'}</span>
                    <span className={styles.sourceBadge}>{g.source === 'rdagent' ? 'RD' : '本地'}</span>
                    <span className={styles.groupName}>{g.name}</span>
                    <span className={styles.muted}>{g.runs.length} 运行</span>
                  </button>
                  {expanded.has(g.name) && (
                    <ul className={styles.traceList}>
                      {g.runs.map((r) => {
                        const active = g.source === 'rdagent'
                          ? (selection?.source === 'rdagent' && selection.traceId === r.id)
                          : (selection?.source === 'local' && selection.exp === g.name)
                        return (
                          <li key={r.id}>
                            <button
                              type="button"
                              className={active ? styles.traceActive : styles.trace}
                              onClick={() => {
                                if (g.source === 'rdagent') selectRun('rdagent', r.id)
                                else selectRun('local', g.name)
                              }}
                            >
                              <span className={styles.traceId}>{r.id}</span>
                              <span className={styles.muted}>
                                {r.startedAt !== undefined ? formatTime(r.startedAt) : ''}
                                {r.durationSec !== undefined ? ` · ${Math.round(r.durationSec / 60)} 分钟` : ''}
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </aside>
        <main className={styles.stream}>
          {selection === null ? (
            <div className={styles.muted}>选择左侧实验查看记录</div>
          ) : selection.source === 'local' ? (
            localDetail === null ? (
              <div className={styles.muted}>{loading ? 'loading…' : 'local detail unavailable'}</div>
            ) : (
              <LocalRunView detail={localDetail} />
            )
          ) : data === null ? (
            <div className={styles.muted}>loading…</div>
          ) : (
            <>
              <div className={styles.filterRow}>
                <div className={styles.viewSwitch}>
                  <button type="button" className={view === 'overview' ? styles.switchActive : styles.switch} onClick={() => { setView('overview') }}>总览</button>
                  <button type="button" className={view === 'equity' ? styles.switchActive : styles.switch} onClick={() => { setView('equity') }}>账户轨迹</button>
                  <button type="button" className={view === 'stream' ? styles.switchActive : styles.switch} onClick={() => { setView('stream') }}>消息流</button>
                </div>
                <input
                  className={styles.filter}
                  placeholder="filter tag…"
                  value={tagFilter}
                  onChange={(e) => { setTagFilter(e.target.value) }}
                />
              </div>
              {view === 'overview' ? (
                <>
                  <SummaryView messages={data.messages} />
                  <MetricsView messages={data.messages} />
                  <FeedbackView messages={data.messages} />
                  <CodeView messages={data.messages} />
                  <TimelineView messages={data.messages} filter={tagFilter} />
                </>
              ) : view === 'equity' ? (
                <EquityView messages={data.messages} />
              ) : (
                data.messages
                  .filter(m => tagFilter === '' || m.tag.includes(tagFilter))
                  .map((m, i) => (
                    <div key={`${m.timestamp}-${i}`} className={styles.message}>
                      <div className={styles.messageHeader}>
                        <code className={styles.tag}>{m.tag}</code>
                        <span className={styles.time}>{formatTime(m.timestamp)}</span>
                      </div>
                      <ContentView content={m.content} />
                    </div>
                  ))
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
