/**
 * REAL-composition coverage: a test-only cordis.yml booted through the
 * vendored Loader mounts the webserver and rdagent-bridge rows, and every
 * assertion observes the HTTP surface of the running server. The trace
 * endpoint runs a fake "pythonBin" (node executing a stub script) so the
 * tests need no Python or rdagent installation.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import * as Bridge from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Write a cordis.yml with webserver + bridge rows, then boot through the real Loader. */
async function loadComposition(port = 0, withLocalRoot = false): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-rdagent-bridge-loader-'))
  const configPath = join(root, 'cordis.yml')
  const rows = [
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    `    port: ${String(port)}`,
    '',
    "- name: '@deepseek-ai/dsh-rdagent-bridge'",
    '  config:',
    `    logDir: ${join(root, 'logs')}`,
    `    pythonBin: ${process.execPath}`,
    `    parseScript: ${join(root, 'stub.cjs')}`,
  ]
  if (withLocalRoot) rows.push(`    experimentRoot: ${join(root, 'experiments')}`)
  rows.push('')
  await writeFile(configPath, rows.join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['@deepseek-ai/dsh-rdagent-bridge', Bridge],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

async function request(port: number, path: string, init?: RequestInit): Promise<{ status: number; body: string }> {
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, init)
  return { status: response.status, body: await response.text() }
}

describe('rdagent-bridge routes', () => {
  it('lists trace directories under logDir without touching Python', async () => {
    const ctx = await loadComposition()
    await mkdir(join(root!, 'logs', 'trace-a'), { recursive: true })
    await mkdir(join(root!, 'logs', 'trace-b'), { recursive: true })
    await writeFile(join(root!, 'logs', 'trace-a', 'x.pkl'), 'x')

    const res = await request(ctx.webServer.port, '/rdagent/traces')
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body) as { traces: { id: string }[] }
    expect(body.traces.map(t => t.id).sort()).toEqual(['trace-a', 'trace-b'])
  })

  it('runs the parse script for a trace and returns its JSON', async () => {
    const ctx = await loadComposition()
    await mkdir(join(root!, 'logs', 'trace-a'), { recursive: true })
    // Stub "python": echoes a fixed JSON document for any arguments.
    await writeFile(
      join(root!, 'stub.cjs'),
      'console.log(JSON.stringify({ trace: process.argv[3] ?? "?", count: 1, messages: [{ tag: "scenario", content: "ok" }] }))\n',
    )

    const res = await request(ctx.webServer.port, '/rdagent/trace?id=trace-a&limit=5')
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body) as { trace: string; messages: { content: string }[] }
    expect(body.trace).toBe('trace-a')
    expect(body.messages[0]?.content).toBe('ok')
  })

  it('rejects trace ids that escape logDir', async () => {
    const ctx = await loadComposition()
    const res = await request(ctx.webServer.port, '/rdagent/trace?id=..%2Foutside')
    expect(res.status).toBe(400)
  })

  it('passes account-curve rows through verbatim', async () => {
    const ctx = await loadComposition()
    await mkdir(join(root!, 'logs', 'trace-a'), { recursive: true })
    const rows = [
      { account: 100000000, bench: 1.0, turnover: 0.0 },
      { account: 102500000, bench: 1.012, turnover: 0.4 },
    ]
    await writeFile(
      join(root!, 'stub.cjs'),
      `console.log(JSON.stringify({ trace: "trace-a", count: 1, messages: [{ tag: "Quantitative Backtesting Chart", content: { type: "DataFrame", shape: [2, 3], columns: ["account", "bench", "turnover"], rows: ${JSON.stringify(rows)} } }] }))\n`,
    )

    const res = await request(ctx.webServer.port, '/rdagent/trace?id=trace-a&limit=5')
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body) as {
      messages: { content: { type: string; rows: { account: number }[] } }[]
    }
    expect(body.messages[0]?.content.type).toBe('DataFrame')
    expect(body.messages[0]?.content.rows).toEqual(rows)
  })

  it('redirects RD-Agent log writes away from the server cwd', async () => {
    const ctx = await loadComposition()
    await mkdir(join(root!, 'logs', 'trace-a'), { recursive: true })
    await writeFile(
      join(root!, 'stub.cjs'),
      'console.log(JSON.stringify({ trace: "trace-a", count: 0, messages: [], tracePath: process.env.LOG_TRACE_PATH ?? null }))\n',
    )

    const res = await request(ctx.webServer.port, '/rdagent/trace?id=trace-a&limit=5')
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body) as { tracePath: string | null }
    expect(body.tracePath).toContain('dsh-rdagent-parse-log')
  })

  it('answers 404 for unknown paths and 405 for non-GET', async () => {
    const ctx = await loadComposition()
    const notFound = await request(ctx.webServer.port, '/rdagent/nope')
    expect(notFound.status).toBe(404)
    const post = await request(ctx.webServer.port, '/rdagent/traces', {
      method: 'POST',
      body: '',
    })
    expect(post.status).toBe(405)
  })

  it('resolves two-segment trace ids (experiment/timestamp)', async () => {
    const ctx = await loadComposition()
    await mkdir(join(root!, 'logs', 'expA', '2026-08-20_10-00-00-000000'), { recursive: true })
    await writeFile(join(root!, 'logs', 'expA', '2026-08-20_10-00-00-000000', 'x.pkl'), 'x')
    await writeFile(
      join(root!, 'stub.cjs'),
      'console.log(JSON.stringify({ trace: process.argv[3] ?? "?", count: 0, messages: [] }))\n',
    )

    const res = await request(ctx.webServer.port, '/rdagent/trace?id=expA%2F2026-08-20_10-00-00-000000&limit=5')
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body) as { trace: string }
    expect(body.trace).toBe('expA/2026-08-20_10-00-00-000000')
  })

  it('rejects three-segment trace ids', async () => {
    const ctx = await loadComposition()
    await mkdir(join(root!, 'logs', 'a', 'b', 'c'), { recursive: true })
    const res = await request(ctx.webServer.port, '/rdagent/trace?id=a%2Fb%2Fc')
    expect(res.status).toBe(400)
  })
})

describe('local experiments', () => {
  it('groups rdagent traces by experiment and serves the local tree', async () => {
    const ctx = await loadComposition(0, true)
    // nested rdagent experiment + flat trace
    await mkdir(join(root!, 'logs', 'expA', 'ts1'), { recursive: true })
    await writeFile(join(root!, 'logs', 'expA', 'ts1', 'x.pkl'), 'x')
    await mkdir(join(root!, 'logs', 'ts2'), { recursive: true })
    await writeFile(join(root!, 'logs', 'ts2', 'x.pkl'), 'x')
    // local exp1s-style (JSONL manifest + runs) and exp2-style (standard JSON)
    await mkdir(join(root!, 'experiments', 'exp1s', 'runs', 'F5c_s2023'), { recursive: true })
    await writeFile(
      join(root!, 'experiments', 'exp1s', 'manifest.json'),
      `${JSON.stringify({ generated: '2026-08-19T00:31+08:00', design: 'v2', runs: [] })}\n` +
        `${JSON.stringify({ run_id: 'F5c_s2023', tag: 'F5c', secs: 3258, moved: true })}\n`,
    )
    await mkdir(join(root!, 'experiments', 'exp2', 'metrics'), { recursive: true })
    await writeFile(
      join(root!, 'experiments', 'exp2', 'manifest.json'),
      JSON.stringify({ generated: '2026-08-18T23:25+08:00', design: 'v2', hashes: { price_csv: {} } }),
    )

    const res = await request(ctx.webServer.port, '/experiments')
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body) as {
      experiments: { name: string; source: string; runs: { id: string }[] }[]
    }
    const names = body.experiments.map(e => `${e.source}:${e.name}`)
    expect(names).toContain('rdagent:expA')
    expect(names).toContain('rdagent:未分组')
    expect(names).toContain('local:exp1s')
    expect(names).toContain('local:exp2')
    const expA = body.experiments.find(e => e.name === 'expA')!
    expect(expA.runs.map(r => r.id)).toEqual(['ts1'])
    const exp1s = body.experiments.find(e => e.name === 'exp1s')!
    expect(exp1s.runs[0]?.id).toBe('F5c_s2023')
    const exp2 = body.experiments.find(e => e.name === 'exp2')!
    expect(exp2.runs).toEqual([])
  })

  it('extracts columnar series and decodes UTF-16LE logs for a local experiment', async () => {
    const ctx = await loadComposition(0, true)
    await mkdir(join(root!, 'experiments', 'exp2', 'metrics'), { recursive: true })
    await writeFile(
      join(root!, 'experiments', 'exp2', 'manifest.json'),
      JSON.stringify({ generated: 't', design: 'd', hashes: {} }),
    )
    await writeFile(
      join(root!, 'experiments', 'exp2', 'metrics', 'daily_series.json'),
      JSON.stringify({
        series: { date: ['2025-01-02', '2025-01-03'], band_topk: [0.01, -0.02], band_width_K: [20, 20] },
      }),
    )
    // UTF-16LE log with BOM
    const log = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('login success!', 'utf16le')])
    await mkdir(join(root!, 'experiments', 'exp2', 'run_logs'), { recursive: true })
    await writeFile(join(root!, 'experiments', 'exp2', 'run_logs', 'fetch.log'), log)

    const res = await request(ctx.webServer.port, '/experiments/run?exp=exp2')
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body) as {
      series: { label: string; dates: string[]; values: number[] }[]
      reports: { label: string; text: string }[]
    }
    const band = body.series.find(s => s.label === 'band_topk')
    expect(band?.dates).toEqual(['2025-01-02', '2025-01-03'])
    expect(band?.values).toEqual([0.01, -0.02])
    const report = body.reports.find(r => r.label.includes('fetch.log'))
    expect(report?.text).toContain('login success!')
  })

  it('tolerates a broken manifest row with warnings instead of 500', async () => {
    const ctx = await loadComposition(0, true)
    await mkdir(join(root!, 'experiments', 'exp1s'), { recursive: true })
    await writeFile(
      join(root!, 'experiments', 'exp1s', 'manifest.json'),
      `${JSON.stringify({ generated: 't' })}\n{bad json line\n`,
    )

    const res = await request(ctx.webServer.port, '/experiments/run?exp=exp1s')
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body) as { warnings: string[] }
    expect(body.warnings.length).toBeGreaterThan(0)
  })

  it('serves artifact text and rejects paths escaping the experiment root', async () => {
    const ctx = await loadComposition(0, true)
    await mkdir(join(root!, 'experiments', 'exp1', 'metrics'), { recursive: true })
    await writeFile(join(root!, 'experiments', 'exp1', 'metrics', 'note.txt'), 'hello 中文')

    const ok = await request(ctx.webServer.port, '/experiments/artifact?exp=exp1&path=metrics%2Fnote.txt')
    expect(ok.status).toBe(200)
    const body = JSON.parse(ok.body) as { text: string }
    expect(body.text).toBe('hello 中文')

    const escape = await request(ctx.webServer.port, '/experiments/artifact?exp=exp1&path=..%2F..%2Fsecret.txt')
    expect(escape.status).toBe(400)
  })

  it('serves run-level detail with meta and file listing', async () => {
    const ctx = await loadComposition(0, true)
    await mkdir(join(root!, 'experiments', 'exp1s', 'runs', 'F5c_s2023', 'model0'), { recursive: true })
    await writeFile(
      join(root!, 'experiments', 'exp1s', 'manifest.json'),
      `${JSON.stringify({ generated: 't', design: 'v2', runs: [] })}\n` +
        `${JSON.stringify({ run_id: 'F5c_s2023', tag: 'F5c', seed: 2023, secs: 3258, moved: true })}\n`,
    )
    await writeFile(join(root!, 'experiments', 'exp1s', 'runs', 'F5c_s2023', 'model0', 'model.pth'), Buffer.alloc(16))
    await writeFile(join(root!, 'experiments', 'exp1s', 'runs', 'F5c_s2023', 'losses.csv'), 'a,b\n1,2\n')

    const res = await request(ctx.webServer.port, '/experiments/run?exp=exp1s&run=F5c_s2023')
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body) as { run: { id: string; meta: Record<string, unknown>; files: { path: string }[] } }
    expect(body.run.id).toBe('F5c_s2023')
    expect(body.run.meta.seed).toBe(2023)
    expect(body.run.files.map(f => f.path).sort()).toEqual(['losses.csv', 'model0/model.pth'])
  })
})
