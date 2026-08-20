/**
 * @deepseek-ai/dsh-rdagent-bridge — RD-Agent trace bridge plugin.
 *
 * Registers the `/rdagent` prefix on `ctx.webServer` with two read-only GET
 * endpoints that let browser plugins render RD-Agent trace logs:
 *
 * - `GET /rdagent/traces` lists the trace directories under `logDir`
 *   (name, latest mtime, pkl count) without touching Python.
 * - `GET /rdagent/trace?id=<trace>&limit=<n>&tag=<substring>` runs
 *   `scripts/parse_trace.py` (the configured `pythonBin`) to convert the
 *   pickled RD-Agent `Message` log into JSON.
 *
 * The prefix deliberately avoids `/api` (owned by the connection plugin's
 * envelope protocol); these are plain data endpoints for same-origin fetch.
 * `logDir` is required configuration; a missing directory fails loud on the
 * first request. `trace` ids are path-normalized and confined to `logDir`.
 */

import { spawn } from 'node:child_process'
import { readFile, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { buildLocalTree, extractSeries, listRunFiles, readTextFile, type LocalExperiment } from './local.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: WebServer
  }
}

/** Plugin configuration. */
export interface Config {
  /** Root directory holding RD-Agent trace folders. */
  logDir: string
  /** Python executable that can import `rdagent` (must match the RD-Agent env). */
  pythonBin: string
  /** Override for the parse script; defaults to the packaged scripts/parse_trace.py. */
  parseScript?: string
  /** Root directory holding local quant-experiment trees (experiments/<name>/). */
  experimentRoot?: string
}

export const name = 'rdagent-bridge'
export const inject = ['webServer']
export const Config: z<Config> = z.object({
  logDir: z.string(),
  pythonBin: z.string().default('python'),
  parseScript: z.string().default(''),
  experimentRoot: z.string().default(''),
})

const SCRIPT_PATH = fileURLToPath(new URL('../scripts/parse_trace.py', import.meta.url))

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readQuery(url: string | undefined): URLSearchParams {
  return new URL(url ?? '/', 'http://rdagent-bridge.internal').searchParams
}

/** Resolve a trace id inside logDir, or null when it escapes the root.
 * Ids may be one or two path segments (`<ts>` or `<experiment>/<ts>`). */
function resolveTrace(logDir: string, id: string): string | null {
  const root = path.resolve(logDir)
  const candidate = path.resolve(root, id)
  if (candidate === root) return null
  if (!candidate.startsWith(root + path.sep)) return null
  const segments = path.relative(root, candidate).split(path.sep)
  if (segments.length > 2) return null
  if (segments.some(s => s === '' || s === '.' || s === '..')) return null
  return candidate
}

/** True when a directory directly holds trace content (pkl files or a session dir). */
async function isTraceDir(dir: string): Promise<boolean> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name === '__session__') return true
    if (entry.isFile() && entry.name.endsWith('.pkl')) return true
  }
  return false
}

/** One trace summary inside a directory. */
async function traceSummary(dir: string, id: string): Promise<{ id: string; updatedAt: string; pklCount: number }> {
  let pklCount = 0
  let updatedAt = ''
  try {
    const info = await stat(dir)
    updatedAt = info.mtime.toISOString()
    const files = await readdir(dir, { recursive: true })
    pklCount = files.filter(f => f.endsWith('.pkl') && !f.endsWith('debug_llm.pkl')).length
  } catch {
    // unreadable trace dir: report it with zeros rather than failing the list
  }
  return { id, updatedAt, pklCount }
}

/** One trace summary row. */
interface TraceSummaryRow {
  id: string
  updatedAt: string
  pklCount: number
}

/** RD-Agent traces grouped by experiment name. */
interface RdagentGroup {
  name: string
  traces: TraceSummaryRow[]
}

/** List RD-Agent traces grouped by experiment: `log/<experiment>/<ts>/` when
 * nested, else a single unnamed group with the flat traces. */
async function listRdagentGroups(logDir: string): Promise<RdagentGroup[]> {
  const entries = await readdir(logDir, { withFileTypes: true })
  const groups: RdagentGroup[] = []
  const flat: TraceSummaryRow[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(logDir, entry.name)
    if (await isTraceDir(dir)) {
      flat.push(await traceSummary(dir, entry.name))
      continue
    }
    // experiment group: collect its trace children
    const traces: TraceSummaryRow[] = []
    for (const child of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!child.isDirectory()) continue
      if (await isTraceDir(path.join(dir, child.name))) {
        traces.push(await traceSummary(path.join(dir, child.name), child.name))
      }
    }
    traces.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    if (traces.length > 0) groups.push({ name: entry.name, traces })
  }
  flat.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  if (flat.length > 0) groups.push({ name: '未分组', traces: flat })
  groups.sort((a, b) => (a.name < b.name ? -1 : 1))
  return groups
}

/** Flat trace list (legacy endpoint semantics: every subdirectory). */
async function listTraces(logDir: string): Promise<TraceSummaryRow[]> {
  const entries = await readdir(logDir, { withFileTypes: true })
  const traces: TraceSummaryRow[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    traces.push(await traceSummary(path.join(logDir, entry.name), entry.name))
  }
  traces.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  return traces
}

function parseTrace(
  pythonBin: string,
  script: string,
  logDir: string,
  traceId: string,
  limit: string,
  tag: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [script, logDir, traceId, '--limit', limit]
    if (tag) args.push('--tag', tag)
    // RD-Agent's logger writes a fresh trace folder (with a debug_tpl message)
    // on import; redirect its LOG_TRACE_PATH to the OS temp so a parse never
    // pollutes the server's working directory.
    const child = spawn(pythonBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LOG_TRACE_PATH: path.join(tmpdir(), 'dsh-rdagent-parse-log') },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', (error) => { reject(new Error(`failed to start ${pythonBin}: ${error.message}`)) })
    child.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`parse_trace.py exited ${code}: ${stderr.slice(0, 500)}`))
    })
  })
}

/** Resolve an experiment-relative artifact path inside the local root, or null. */
function resolveLocal(root: string, exp: string, relPath: string): string | null {
  const base = path.resolve(root, exp)
  const candidate = path.resolve(base, relPath)
  if (candidate === base) return null
  if (!candidate.startsWith(base + path.sep)) return null
  const segments = path.relative(base, candidate).split(path.sep)
  if (segments.length > 3) return null
  if (segments.some(s => s === '' || s === '.' || s === '..')) return null
  return candidate
}

/** Read up to a few metrics JSON files of a local experiment into series. */
async function localSeries(experiment: LocalExperiment, root: string): Promise<{ label: string; dates: string[]; values: number[] }[]> {
  const out: { label: string; dates: string[]; values: number[] }[] = []
  const metricsDir = path.join(root, experiment.name, 'metrics')
  const files = await readdir(metricsDir).catch(() => [])
  for (const file of files.filter(f => f.endsWith('.json')).slice(0, 5)) {
    const filePath = path.join(metricsDir, file)
    const info = await stat(filePath).catch(() => null)
    if (info === null || info.size > 2 * 1024 * 1024) continue
    const text = await readFile(filePath, 'utf8').catch(() => '')
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      out.push(...extractSeries(parsed))
    } catch {
      // unparsable metrics file: skip silently
    }
  }
  return out
}

/**
 * Install the bridge: register the `/rdagent` and `/experiments` prefixes.
 * @param ctx - Cordis context with `webServer`.
 * @param config - validated plugin configuration.
 * @returns the route disposers.
 */
export function apply(ctx: Context, config: Config): () => void {
  const logDir = path.resolve(config.logDir)
  const script = config.parseScript || SCRIPT_PATH
  const localRoot = config.experimentRoot === undefined || config.experimentRoot === ''
    ? null
    : path.resolve(config.experimentRoot)

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method not allowed' })
      return
    }
    const pathname = new URL(req.url ?? '/', 'http://rdagent-bridge.internal').pathname
    try {
      if (pathname === '/rdagent/traces') {
        sendJson(res, 200, { traces: await listTraces(logDir) })
        return
      }
      if (pathname === '/rdagent/trace') {
        const query = readQuery(req.url)
        const traceId = query.get('id') ?? ''
        const tracePath = resolveTrace(logDir, traceId)
        if (tracePath === null) {
          sendJson(res, 400, { error: 'trace id escapes logDir' })
          return
        }
        const limit = query.get('limit') ?? '2000'
        const tag = query.get('tag') ?? ''
        const stdout = await parseTrace(config.pythonBin, script, logDir, traceId, limit, tag)
        sendJson(res, 200, JSON.parse(stdout))
        return
      }
      if (pathname === '/experiments' && localRoot !== null) {
        const rdagentGroups = (await listRdagentGroups(logDir)).map(g => ({
          name: g.name,
          source: 'rdagent',
          runs: g.traces.map(t => ({ id: t.id, startedAt: t.updatedAt, meta: { pklCount: t.pklCount } })),
          artifacts: [],
        }))
        const localTree = await buildLocalTree(localRoot)
        const localGroups = localTree.experiments.map(e => ({
          name: e.name,
          source: 'local',
          runs: e.runs,
          artifacts: e.artifacts,
          warnings: e.warnings,
        }))
        sendJson(res, 200, { experiments: [...rdagentGroups, ...localGroups] })
        return
      }
      if (pathname === '/experiments/run' && localRoot !== null) {
        const query = readQuery(req.url)
        const exp = query.get('exp') ?? ''
        const run = query.get('run') ?? ''
        const expDir = path.resolve(localRoot, exp)
        if (exp === '' || !expDir.startsWith(path.resolve(localRoot) + path.sep)) {
          sendJson(res, 400, { error: 'invalid experiment' })
          return
        }
        const tree = await buildLocalTree(localRoot)
        const experiment = tree.experiments.find(e => e.name === exp)
        if (experiment === undefined) {
          sendJson(res, 404, { error: `experiment not found: ${exp}` })
          return
        }
        const series = await localSeries(experiment, localRoot)
        const reports: { label: string; text: string }[] = []
        for (const artifact of experiment.artifacts) {
          if (artifact.kind !== 'report' && artifact.kind !== 'log') continue
          if (reports.length >= 3) break
          const filePath = resolveLocal(localRoot, exp, artifact.path)
          if (filePath === null) continue
          const text = await readTextFile(filePath).catch(() => null)
          if (text !== null) reports.push({ label: artifact.label, text: text.slice(0, 100 * 1024) })
        }
        let runDetail: { id: string; meta: Record<string, unknown>; files: unknown[] } | undefined
        if (run !== '') {
          const known = experiment.runs.some(r => r.id === run)
          runDetail = {
            id: run,
            meta: experiment.runs.find(r => r.id === run)?.meta ?? {},
            files: known ? await listRunFiles(localRoot, exp, run) : [],
          }
        }
        sendJson(res, 200, {
          name: experiment.name,
          source: 'local',
          runs: experiment.runs,
          artifacts: experiment.artifacts,
          warnings: experiment.warnings,
          series,
          reports,
          ...(runDetail !== undefined ? { run: runDetail } : {}),
        })
        return
      }
      if (pathname === '/experiments/artifact' && localRoot !== null) {
        const query = readQuery(req.url)
        const exp = query.get('exp') ?? ''
        const artifactPath = query.get('path') ?? ''
        const filePath = resolveLocal(localRoot, exp, artifactPath)
        if (filePath === null) {
          sendJson(res, 400, { error: 'artifact path escapes experiment root' })
          return
        }
        const text = await readTextFile(filePath).catch(() => null)
        if (text === null) {
          sendJson(res, 404, { error: 'artifact missing or too large' })
          return
        }
        sendJson(res, 200, { exp, path: artifactPath, text })
        return
      }
      sendJson(res, 404, { error: 'not found' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[rdagent-bridge] ${req.method} ${pathname} failed: ${message}`)
      sendJson(res, 500, { error: message })
    }
  }

  const disposers: (() => void)[] = [ctx.webServer.register({ kind: 'prefix', path: '/rdagent', handler })]
  if (localRoot !== null) disposers.push(ctx.webServer.register({ kind: 'prefix', path: '/experiments', handler }))
  return () => {
    for (const dispose of disposers) dispose()
  }
}
