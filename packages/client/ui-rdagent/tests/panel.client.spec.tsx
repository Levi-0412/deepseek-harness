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
          rows: [
            { account: 100000000.0, return: 0.0, turnover: 0.0, cost: 0.0, value: 0.0, cash: 100000000.0, bench: 1.0 },
            { account: 101000000.0, return: 0.01, turnover: 0.5, cost: 25000.0, value: 50000000.0, cash: 51000000.0, bench: 1.005 },
            { account: 102500000.0, return: 0.015, turnover: 0.4, cost: 20000.0, value: 80000000.0, cash: 22500000.0, bench: 1.012 },
          ],
        },
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
    if (url.includes('/rdagent/traces')) {
      return { ok: true, status: 200, json: async () => ({ traces: [{ id: 't1', updatedAt: '2026-08-19T10:00:00Z', pklCount: 5 }] }) }
    }
    if (url.includes('/rdagent/trace')) {
      return { ok: true, status: 200, json: async () => makeTraceData() }
    }
    return { ok: false, status: 404, json: async () => ({ error: 'not found' }) }
  }))
}

describe('RdagentPanel', () => {
  it('renders the trace list and all structured views after selecting a trace', async () => {
    stubBridge()
    render(<RdagentPanel onClose={() => {}} />)

    await waitFor(() => { expect(screen.getByText('t1')).toBeTruthy() })
    fireEvent.click(screen.getByText('t1'))

    await waitFor(() => { expect(screen.getByText('回测指标')).toBeTruthy() })
    expect(screen.getByText('因子摘要')).toBeTruthy()
    expect(screen.getByText('momentum_20d')).toBeTruthy()
    expect(screen.getByText('volume_ratio_20d')).toBeTruthy()
    expect(screen.getByText('对话 deepseek-chat')).toBeTruthy()
    expect(screen.getByText('Embedding BAAI/bge-m3')).toBeTruthy()
    expect(screen.getByText('研究假设')).toBeTruthy()
    // the hypothesis renders both in the summary strip and the hypotheses view
    expect(screen.getAllByText('Momentum factors predict returns').length).toBeGreaterThan(0)
    expect(screen.getByText('实现评估反馈')).toBeTruthy()
    expect(screen.getByText('因子实现代码')).toBeTruthy()
    expect(screen.getByText('流程时间线')).toBeTruthy()
    // metric badge values rendered (badge + table both show the value)
    expect(screen.getAllByText('0.1800').length).toBeGreaterThan(0)
  })

  it('renders the account-curve view with chart and stats', async () => {
    stubBridge()
    render(<RdagentPanel onClose={() => {}} />)

    await waitFor(() => { expect(screen.getByText('t1')).toBeTruthy() })
    fireEvent.click(screen.getByText('t1'))
    await waitFor(() => { expect(screen.getByText('回测指标')).toBeTruthy() })

    fireEvent.click(screen.getByText('账户轨迹'))
    expect(await screen.findByText('期末相对收益')).toBeTruthy()
    expect(screen.getByText('2.50%')).toBeTruthy() // (102.5M / 100M) - 1
    expect(screen.getByText('最大回撤')).toBeTruthy()
    expect(screen.getByRole('img', { name: '账户净值与基准曲线' })).toBeTruthy()
    expect(screen.getByText('组合 2.50%')).toBeTruthy()
  })

  it('renders the flattened baseline comparison from the runner result', async () => {
    stubBridge()
    render(<RdagentPanel onClose={() => {}} />)

    await waitFor(() => { expect(screen.getByText('t1')).toBeTruthy() })
    fireEvent.click(screen.getByText('t1'))
    await waitFor(() => { expect(screen.getByText('回测指标')).toBeTruthy() })
    // headline badge meta shows the baseline IR from based_experiments[0]
    expect(screen.getByText(/baseline 2\.300/)).toBeTruthy()
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
