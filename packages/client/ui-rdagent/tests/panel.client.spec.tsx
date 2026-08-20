// @vitest-environment jsdom
// RdagentPanel rendering: the structured views (metric badges, hypotheses,
// feedback, code, timeline) over mocked bridge responses, plus the
// RdagentTrigger drawer open/close lifecycle.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RdagentPanel, type TraceData } from '../src/client/RdagentPanel.tsx'
import { RdagentTrigger } from '../src/client/RdagentTrigger.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function makeTraceData(): TraceData {
  return {
    trace: 't1',
    count: 4,
    messages: [
      {
        tag: 'scenario',
        timestamp: '2026-08-19T10:00:00Z',
        pid: '1',
        content: { rich_style_description: 'scenario desc' },
      },
      {
        tag: 'Loop_0.direct_exp_gen.hypothesis generation',
        timestamp: '2026-08-19T10:00:01Z',
        pid: '1',
        content: { hypothesis: 'Momentum factors predict returns' },
      },
      {
        tag: 'Loop_0.direct_exp_gen.experiment generation',
        timestamp: '2026-08-19T10:00:00Z',
        pid: '1',
        content: ['<FactorTask[momentum_20d]>', '<FactorTask[volume_ratio_20d]>'],
      },
      {
        tag: 'Loop_0.direct_exp_gen.LITELLM_SETTINGS',
        timestamp: '2026-08-19T10:00:00Z',
        pid: '1',
        content: { chat_model: 'openai/deepseek-chat', embedding_model: 'litellm_proxy/BAAI/bge-m3' },
      },
      {
        tag: 'Loop_0.running.Quantitative Backtesting Chart',
        timestamp: '2026-08-19T10:00:02Z',
        pid: '1',
        content: {
          type: 'DataFrame',
          shape: [3, 9],
          columns: ['account', 'return', 'total_turnover', 'turnover', 'total_cost', 'cost', 'value', 'cash', 'bench'],
          // Baseline run: RD-Agent records this FIRST; the panel must show the LAST chart.
          rows: [
            { account: 100000000.0, return: 0.0, turnover: 0.0, cost: 0.0, value: 0.0, cash: 100000000.0, bench: 1.0 },
            { account: 100500000.0, return: 0.005, turnover: 0.3, cost: 15000.0, value: 40000000.0, cash: 60500000.0, bench: 1.003 },
            { account: 101500000.0, return: 0.01, turnover: 0.35, cost: 17500.0, value: 60000000.0, cash: 41500000.0, bench: 1.008 },
          ],
        },
      },
      {
        tag: 'Loop_0.running.Quantitative Backtesting Chart',
        timestamp: '2026-08-19T10:00:02Z',
        pid: '1',
        content: {
          type: 'DataFrame',
          shape: [3, 9],
          columns: ['account', 'return', 'total_turnover', 'turnover', 'total_cost', 'cost', 'value', 'cash', 'bench'],
          // Current combination: last chart message, ends at 102.5M. bench is
          // the single-day-return column (qlib format), not a net-value column.
          rows: [
            { account: 100000000.0, return: 0.0, turnover: 0.0, cost: 0.0, value: 0.0, cash: 100000000.0, bench: 0.0 },
            { account: 101000000.0, return: 0.01, turnover: 0.5, cost: 25000.0, value: 50000000.0, cash: 51000000.0, bench: 0.005 },
            { account: 102500000.0, return: 0.015, turnover: 0.4, cost: 20000.0, value: 80000000.0, cash: 22500000.0, bench: 0.012 },
          ],
        },
      },
      {
        tag: 'Loop_0.running.Qlib_execute_log',
        timestamp: '2026-08-19T10:00:02Z',
        pid: '1',
        content: 'Training until validation scores don\'t improve for 50 rounds\n[20]\ttrain\'s l2: 0.952\tvalid\'s l2: 0.983',
      },
      {
        tag: 'Loop_0.running.runner result',
        timestamp: '2026-08-19T10:00:02Z',
        pid: '1',
        content: {
          type: 'QlibFactorExperiment',
          result: {
            type: 'Series',
            values: {
              '1day.excess_return_with_cost.annualized_return': 0.18,
              '1day.excess_return_with_cost.information_ratio': 1.9,
              '1day.excess_return_with_cost.max_drawdown': -0.23,
              'l2.train': 0.9324,
              'l2.valid': 0.9824,
            },
          },
          based_experiments: [
            {
              type: 'Series',
              values: {
                '1day.excess_return_with_cost.annualized_return': 0.21,
                '1day.excess_return_with_cost.information_ratio': 2.3,
                '1day.excess_return_with_cost.max_drawdown': -0.11,
              },
            },
          ],
        },
      },
      {
        tag: 'Loop_0.coding.evo_loop_0.evolving feedback',
        timestamp: '2026-08-19T10:00:03Z',
        pid: '1',
        content: {
          type: 'CoSTEERMultiFeedback',
          feedback_list: [
            {
              type: 'CoSTEERSingleFeedbackDeprecated',
              final_decision: true,
              final_feedback: 'factor works',
              execution_feedback: 'executed ok',
              code_feedback: 'no critics',
              value_feedback: 'IC positive',
            },
          ],
        },
      },
      {
        tag: 'Loop_0.coding.evo_loop_0.evolving code',
        timestamp: '2026-08-19T10:00:04Z',
        pid: '1',
        content: [
          { type: 'FactorFBWorkspace', files: { 'factor.py': 'def calculate(): pass' } },
        ],
      },
    ],
  }
}

function stubBridge(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => {
    const url = typeof input === 'string' ? input : (input as { url: string }).url
    if (url.includes('/experiments/run')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          name: 'exp2',
          source: 'local',
          runs: [],
          artifacts: [{ label: 'metrics/daily_series.json', kind: 'series', path: 'metrics/daily_series.json', size: 1200 }],
          series: [{ label: 'band_topk', dates: ['2025-01-02', '2025-01-03'], values: [0.01, -0.02] }],
          reports: [{ label: 'run_logs/fetch.log', text: 'login success!' }],
        }),
      }
    }
    if (url.includes('/experiments')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          experiments: [
            {
              name: '量价因子组',
              source: 'rdagent',
              runs: [{ id: 't1', startedAt: '2026-08-19T10:00:00Z', meta: { pklCount: 5 } }],
              artifacts: [],
            },
            {
              name: 'exp2',
              source: 'local',
              runs: [],
              artifacts: [{ label: 'band/band_members.json', kind: 'series', path: 'band/band_members.json', size: 44000 }],
            },
          ],
        }),
      }
    }
    if (url.includes('/rdagent/trace')) {
      return { ok: true, status: 200, json: async () => makeTraceData() }
    }
    return { ok: false, status: 404, json: async () => ({ error: 'not found' }) }
  }))
}

describe('RdagentPanel', () => {
  /** Expand the rdagent group and select the t1 trace. */
  async function selectTrace(): Promise<void> {
    await waitFor(() => { expect(screen.getByText('量价因子组')).toBeTruthy() })
    fireEvent.click(screen.getByText('量价因子组'))
    await waitFor(() => { expect(screen.getByText('t1')).toBeTruthy() })
    fireEvent.click(screen.getByText('t1'))
    await waitFor(() => { expect(screen.getByText('回测指标')).toBeTruthy() })
  }

  it('renders the two-level experiment tree and structured views after selecting a trace', async () => {
    stubBridge()
    render(<RdagentPanel onClose={() => {}} />)

    // first level: experiment groups with source badges
    await waitFor(() => { expect(screen.getByText('量价因子组')).toBeTruthy() })
    expect(screen.getByText('exp2')).toBeTruthy()
    expect(screen.getAllByText('1 运行').length).toBeGreaterThan(0)

    // expand the group, then select the trace
    fireEvent.click(screen.getByText('量价因子组'))
    await waitFor(() => { expect(screen.getByText('t1')).toBeTruthy() })
    fireEvent.click(screen.getByText('t1'))

    await waitFor(() => { expect(screen.getByText('回测指标')).toBeTruthy() })
    expect(screen.getByText('因子摘要')).toBeTruthy()
    expect(screen.getByText('momentum_20d')).toBeTruthy()
    expect(screen.getByText('volume_ratio_20d')).toBeTruthy()
    expect(screen.getByText('LightGBM')).toBeTruthy()
    expect(screen.getByText('训练 l2 0.9324')).toBeTruthy()
    expect(screen.getByText('验证 l2 0.9824')).toBeTruthy()
    // the hypothesis renders in the summary strip
    expect(screen.getByText('Momentum factors predict returns')).toBeTruthy()
    // the standalone hypotheses view was folded into the summary strip
    expect(screen.queryByText('研究假设')).toBeNull()
    expect(screen.getByText('实现评估反馈')).toBeTruthy()
    expect(screen.getByText('因子实现代码')).toBeTruthy()
    expect(screen.getByText('流程时间线')).toBeTruthy()
    // metric badge values rendered (badge + table both show the value)
    expect(screen.getAllByText('0.1800').length).toBeGreaterThan(0)
  })

  it('renders the account-curve view with chart and stats', async () => {
    stubBridge()
    render(<RdagentPanel onClose={() => {}} />)
    await selectTrace()

    fireEvent.click(screen.getByText('账户轨迹'))
    expect(await screen.findByText('期末累计收益')).toBeTruthy()
    expect(screen.getByText('2.50%')).toBeTruthy() // (102.5M / 100M) - 1
    expect(screen.getByText('最大回撤')).toBeTruthy()
    expect(screen.getByRole('img', { name: '账户累计收益与基准累计收益曲线' })).toBeTruthy()
    expect(screen.getByText('组合 2.50%')).toBeTruthy()
    expect(screen.getByText('基准累计收益')).toBeTruthy()
    expect(screen.getByText('1.71%')).toBeTruthy() // (1.0 * 1.005 * 1.012) - 1
  })

  it('renders the flattened baseline comparison from the runner result', async () => {
    stubBridge()
    render(<RdagentPanel onClose={() => {}} />)
    await selectTrace()
    // headline badge meta shows the baseline IR from based_experiments[0]
    expect(screen.getByText(/baseline 2\.300/)).toBeTruthy()
  })

  it('renders local experiment detail without touching /rdagent/trace', async () => {
    const fetches: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => {
      const url = typeof input === 'string' ? input : (input as { url: string }).url
      fetches.push(url)
      if (url.includes('/experiments/run')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            name: 'exp2',
            source: 'local',
            runs: [],
            artifacts: [{ label: 'metrics/daily_series.json', kind: 'series', path: 'metrics/daily_series.json', size: 1200 }],
            series: [{ label: 'band_topk', dates: ['2025-01-02', '2025-01-03'], values: [0.01, -0.02] }],
            reports: [{ label: 'run_logs/fetch.log', text: 'login success!' }],
          }),
        }
      }
      if (url.includes('/experiments')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            experiments: [
              { name: 'exp2', source: 'local', runs: [], artifacts: [], warnings: [] },
            ],
          }),
        }
      }
      return { ok: false, status: 404, json: async () => ({ error: 'not found' }) }
    }))
    render(<RdagentPanel onClose={() => {}} />)

    await waitFor(() => { expect(screen.getByText('exp2')).toBeTruthy() })
    fireEvent.click(screen.getByText('exp2'))

    // local detail view renders series chart, artifacts and reports
    expect(await screen.findByText('指标序列')).toBeTruthy()
    expect(screen.getByRole('img', { name: '序列曲线' })).toBeTruthy()
    expect(screen.getByText('login success!')).toBeTruthy()
    expect(screen.getByText(/daily_series\.json/)).toBeTruthy()
    // never hits the rdagent trace endpoint for a local selection
    expect(fetches.some(f => f.includes('/rdagent/trace'))).toBe(false)
  })

  it('surfaces bridge errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async (): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })))
    render(<RdagentPanel onClose={() => {}} />)
    await waitFor(() => { expect(screen.getByText(/bridge error: HTTP 500: boom/)).toBeTruthy() })
  })
})

describe('RdagentTrigger', () => {
  it('opens the drawer on click and closes on Escape', async () => {
    stubBridge()
    render(<RdagentTrigger wide />)

    fireEvent.click(screen.getByTitle('RD-Agent Traces'))
    await waitFor(() => { expect(screen.getByRole('dialog', { name: 'RD-Agent Traces' })).toBeTruthy() })

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })
})
