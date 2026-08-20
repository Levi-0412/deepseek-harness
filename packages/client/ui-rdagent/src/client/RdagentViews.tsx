/**
 * RD-Agent trace panel auxiliary views: the factor summary strip above the
 * metric cards and the qlib account-curve view (self-contained SVG chart, no
 * chart dependency). All extraction functions are pure over the bridge
 * message list and shared with the main panel.
 */
import { useMemo } from 'react'
import styles from './RdagentPanel.module.css'
import { pickMetrics, type MetricSeries, type TraceMessage } from './RdagentPanel.tsx'

/** One qlib account-curve row (from the backtest chart DataFrame). */
export interface EquityRow {
  account: number
  bench: number
  turnover: number
}

/** The runner-result experiment: current metrics + flattened baselines. */
export function runnerExperimentOf(messages: TraceMessage[]): { result?: MetricSeries | null; baselines: MetricSeries[] } | null {
  for (const m of messages) {
    if (!m.tag.includes('runner result')) continue
    const content = m.content
    if (typeof content !== 'object' || content === null) continue
    const c = content as Record<string, unknown>
    if (!('result' in c) || !('based_experiments' in c)) continue
    const baselines: MetricSeries[] = []
    if (Array.isArray(c.based_experiments)) {
      for (const b of c.based_experiments) {
        const metrics = pickMetrics(b)
        if (metrics !== null) baselines.push(metrics)
      }
    }
    return { result: pickMetrics(c.result), baselines }
  }
  return null
}

/** Factor task names from `experiment generation` messages (`<FactorTask[x]>`). */
function factorNamesOf(messages: TraceMessage[]): string[] {
  const out: string[] = []
  for (const m of messages) {
    if (!m.tag.includes('experiment generation')) continue
    const content = m.content
    if (!Array.isArray(content)) continue
    for (const item of content) {
      if (typeof item !== 'string') continue
      const match = /FactorTask\[([^\]]+)\]/.exec(item)
      if (match !== null && match[1] !== undefined) out.push(match[1])
    }
  }
  return [...new Set(out)]
}

/** One-line hypothesis from `hypothesis generation` messages. */
function hypothesisTextOf(messages: TraceMessage[]): string | null {
  for (const m of messages) {
    if (!m.tag.includes('hypothesis generation')) continue
    const content = m.content
    if (typeof content !== 'object' || content === null) continue
    const h = (content as Record<string, unknown>).hypothesis
    if (typeof h === 'string' && h !== '') return h
  }
  return null
}

/** Pass/fail tally across all evolving-feedback rounds. */
function verdictStatsOf(messages: TraceMessage[]): { passed: number; total: number } | null {
  let passed = 0
  let total = 0
  for (const m of messages) {
    if (!m.tag.includes('evolving feedback')) continue
    const content = m.content
    if (typeof content !== 'object' || content === null) continue
    const list = (content as { feedback_list?: unknown }).feedback_list
    if (!Array.isArray(list)) continue
    for (const f of list) {
      if (typeof f !== 'object' || f === null) continue
      const decision = (f as { final_decision?: unknown }).final_decision
      if (typeof decision === 'boolean') {
        total += 1
        if (decision) passed += 1
      }
    }
  }
  return total > 0 ? { passed, total } : null
}

/** With-cost IR/annualized snapshot for the summary strip (with baseline). */
function metricSnapshotOf(messages: TraceMessage[]): { ir: number | null; annual: number | null; baseIr: number | null } | null {
  const exp = runnerExperimentOf(messages)
  if (exp === null || exp.result === null || exp.result === undefined) return null
  const values = exp.result.values ?? {}
  const baseValues = exp.baselines[0]?.values ?? {}
  return {
    ir: values['1day.excess_return_with_cost.information_ratio'] ?? null,
    annual: values['1day.excess_return_with_cost.annualized_return'] ?? null,
    baseIr: baseValues['1day.excess_return_with_cost.information_ratio'] ?? null,
  }
}

/** The qlib account-curve series (the LAST backtest chart message: RD-Agent
 * records the baseline run first, then the current factor combination, so the
 * last chart is the one this run produced). */
export function equitySeriesOf(messages: TraceMessage[]): EquityRow[] | null {
  const charts = messages.filter(m => m.tag.includes('Backtesting Chart'))
  const m = charts[charts.length - 1]
  if (m === undefined) return null
  const content = m.content
  if (typeof content !== 'object' || content === null) return null
  const rows = (content as { rows?: unknown }).rows
  if (!Array.isArray(rows) || rows.length === 0) return null
  const out: EquityRow[] = []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const rec = row as Record<string, unknown>
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN)
    out.push({ account: num(rec.account), bench: num(rec.bench), turnover: num(rec.turnover) })
  }
  return out.length >= 2 ? out : null
}

/** Quant model info: the qlib learner family (LightGBM when the execution log
 * shows its early-stopping training) plus the train/valid loss from the
 * runner result. */
function quantModelOf(messages: TraceMessage[]): { name: string; train: number | null; valid: number | null } | null {
  let isLgbm = false
  for (const m of messages) {
    if (!m.tag.includes('Qlib_execute_log')) continue
    if (typeof m.content === 'string' && m.content.includes('Training until validation scores')) isLgbm = true
  }
  const exp = runnerExperimentOf(messages)
  const values = exp?.result?.values ?? {}
  const train = values['l2.train'] ?? null
  const valid = values['l2.valid'] ?? null
  if (!isLgbm && train === null && valid === null) return null
  return { name: isLgbm ? 'LightGBM' : 'qlib', train, valid }
}

function fmtPct(v: number): string {
  if (!Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(2)}%`
}

/** Summary strip above the metric cards: factors, models, hypothesis, verdicts. */
export function SummaryView({ messages }: { messages: TraceMessage[] }) {
  const factors = useMemo(() => factorNamesOf(messages), [messages])
  const quantModel = useMemo(() => quantModelOf(messages), [messages])
  const hypothesis = useMemo(() => hypothesisTextOf(messages), [messages])
  const verdicts = useMemo(() => verdictStatsOf(messages), [messages])
  const snapshot = useMemo(() => metricSnapshotOf(messages), [messages])
  if (factors.length === 0 && quantModel === null && hypothesis === null && snapshot === null) return null
  return (
    <section className={styles.card}>
      <h3 className={styles.cardTitle}>因子摘要</h3>
      {factors.length > 0 && (
        <div className={styles.summaryRow}>
          <span className={styles.summaryLabel}>因子</span>
          <div className={styles.chipRow}>
            {factors.map(f => <span key={f} className={styles.factorChip}>{f}</span>)}
          </div>
        </div>
      )}
      {quantModel !== null && (
        <div className={styles.summaryRow}>
          <span className={styles.summaryLabel}>模型</span>
          <div className={styles.chipRow}>
            <span className={styles.modelChip}>{quantModel.name}</span>
            {quantModel.train !== null && <span className={styles.modelChip}>训练 l2 {quantModel.train.toFixed(4)}</span>}
            {quantModel.valid !== null && <span className={styles.modelChip}>验证 l2 {quantModel.valid.toFixed(4)}</span>}
          </div>
        </div>
      )}
      {(verdicts !== null || snapshot !== null) && (
        <div className={styles.summaryRow}>
          <span className={styles.summaryLabel}>结果</span>
          <span className={styles.summaryText}>
            {verdicts !== null && `${verdicts.passed}/${verdicts.total} 因子通过`}
            {verdicts !== null && snapshot !== null && ' · '}
            {snapshot !== null && `IR ${snapshot.ir !== null ? snapshot.ir.toFixed(2) : '—'}`}
            {snapshot !== null && snapshot.annual !== null && ` · 年化 ${fmtPct(snapshot.annual)}`}
            {snapshot !== null && snapshot.baseIr !== null && `（baseline IR ${snapshot.baseIr.toFixed(2)}）`}
          </span>
        </div>
      )}
      {hypothesis !== null && <blockquote className={styles.hypothesis}>{hypothesis}</blockquote>}
    </section>
  )
}

const CHART_WIDTH = 720
const CHART_HEIGHT = 220
const CHART_PAD = 10

/** Compounding daily returns into a cumulative-return series (qlib's bench
 * column holds single-day returns, unlike the account column which holds
 * equity values). Non-finite days keep the previous accumulation. */
function cumulativeReturns(daily: number[]): number[] {
  const out: number[] = []
  let acc = 1
  for (const v of daily) {
    if (Number.isFinite(v)) acc *= 1 + v
    out.push(acc - 1)
  }
  return out
}

/** Self-contained SVG line chart of the cumulative account vs benchmark returns. */
export function EquityCurveChart({ rows }: { rows: EquityRow[] }) {
  const { accountPoints, benchPoints, grid, last } = useMemo(() => {
    const first = rows[0]
    if (first === undefined) {
      return { accountPoints: '', benchPoints: '', grid: [], last: { account: NaN, bench: NaN } }
    }
    const n = rows.length
    const a0 = first.account
    const account = rows.map(r => (a0 !== 0 ? r.account / a0 - 1 : NaN))
    const bench = cumulativeReturns(rows.map(r => r.bench))
    const finite = [...account, ...bench].filter(Number.isFinite)
    const min = Math.min(...finite)
    const max = Math.max(...finite)
    const span = max - min
    const lo = span < 1e-9 ? min - 0.5 : min - span * 0.05
    const hi = span < 1e-9 ? max + 0.5 : max + span * 0.05
    const x = (i: number): number => CHART_PAD + (i / (n - 1)) * (CHART_WIDTH - 2 * CHART_PAD)
    const y = (v: number): number => CHART_HEIGHT - CHART_PAD - ((v - lo) / (hi - lo)) * (CHART_HEIGHT - 2 * CHART_PAD)
    const poly = (series: number[]): string =>
      series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
    const grid = [0, 1, 2, 3].map((k) => {
      const v = lo + ((hi - lo) * k) / 3
      return { y: y(v).toFixed(1), label: `${(v * 100).toFixed(0)}%` }
    })
    return {
      accountPoints: poly(account),
      benchPoints: poly(bench),
      grid,
      last: { account: account[n - 1] ?? NaN, bench: bench[n - 1] ?? NaN },
    }
  }, [rows])

  return (
    <div>
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className={styles.chart} role="img" aria-label="账户累计收益与基准累计收益曲线">
        {grid.map((g, i) => (
          <g key={i}>
            <line x1={CHART_PAD} x2={CHART_WIDTH - CHART_PAD} y1={g.y} y2={g.y} className={styles.chartGrid} />
            <text x={CHART_WIDTH - CHART_PAD} y={g.y} className={styles.chartLabel}>{g.label}</text>
          </g>
        ))}
        <polyline points={benchPoints} className={styles.chartBench} />
        <polyline points={accountPoints} className={styles.chartValue} />
      </svg>
      <div className={styles.chartLegend}>
        <span className={styles.legendValue}>组合 {fmtPct(last.account)}</span>
        <span className={styles.legendBench}>基准 {fmtPct(last.bench)}</span>
      </div>
    </div>
  )
}

/** Account-curve view: normalized equity chart plus summary badges. */
export function EquityView({ messages }: { messages: TraceMessage[] }) {
  const rows = useMemo(() => equitySeriesOf(messages), [messages])
  const stats = useMemo(() => {
    if (rows === null) return null
    const first = rows[0]
    if (first === undefined) return null
    const a0 = first.account
    let peak = -Infinity
    let mdd = 0
    for (const r of rows) {
      const v = a0 !== 0 ? r.account / a0 : r.account
      if (v > peak) peak = v
      const dd = v / peak - 1
      if (dd < mdd) mdd = dd
    }
    const turnover = rows.reduce((s, r) => s + (Number.isFinite(r.turnover) ? r.turnover : 0), 0) / rows.length
    const last = rows[rows.length - 1]
    if (last === undefined) return null
    return {
      final: a0 !== 0 ? last.account / a0 - 1 : NaN,
      mdd,
      avgTurnover: turnover,
      bench: cumulativeReturns(rows.map(r => r.bench))[rows.length - 1] ?? NaN,
    }
  }, [rows])

  if (rows === null || stats === null) return null
  return (
    <section className={styles.card}>
      <h3 className={styles.cardTitle}>账户轨迹</h3>
      <EquityCurveChart rows={rows} />
      <div className={styles.badgeGrid}>
        <div className={styles.badge}>
          <span className={styles.badgeValue}>{fmtPct(stats.final)}</span>
          <span className={styles.badgeLabel}>期末累计收益</span>
        </div>
        <div className={styles.badge}>
          <span className={styles.badgeValue}>{fmtPct(stats.mdd)}</span>
          <span className={styles.badgeLabel}>最大回撤</span>
        </div>
        <div className={styles.badge}>
          <span className={styles.badgeValue}>{fmtPct(stats.avgTurnover)}</span>
          <span className={styles.badgeLabel}>日均换手</span>
        </div>
        <div className={styles.badge}>
          <span className={styles.badgeValue}>{fmtPct(stats.bench)}</span>
          <span className={styles.badgeLabel}>基准累计收益</span>
        </div>
      </div>
    </section>
  )
}
