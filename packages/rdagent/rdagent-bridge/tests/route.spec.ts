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
async function loadComposition(port = 0): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-rdagent-bridge-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
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
    '',
  ].join('\n'))

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
})
