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
import { readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'

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
}

export const name = 'rdagent-bridge'
export const inject = ['webServer']
export const Config: z<Config> = z.object({
  logDir: z.string(),
  pythonBin: z.string().default('python'),
  parseScript: z.string().default(''),
})

const SCRIPT_PATH = fileURLToPath(new URL('../scripts/parse_trace.py', import.meta.url))

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readQuery(url: string | undefined): URLSearchParams {
  return new URL(url ?? '/', 'http://rdagent-bridge.internal').searchParams
}

/** Resolve a trace id inside logDir, or null when it escapes the root. */
function resolveTrace(logDir: string, id: string): string | null {
  const root = path.resolve(logDir)
  const candidate = path.resolve(root, id)
  if (candidate !== root && candidate.startsWith(root + path.sep) && path.basename(candidate) === id) {
    return candidate
  }
  return null
}

async function listTraces(logDir: string): Promise<{ id: string; updatedAt: string; pklCount: number }[]> {
  const entries = await readdir(logDir, { withFileTypes: true })
  const traces = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(logDir, entry.name)
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
    traces.push({ id: entry.name, updatedAt, pklCount })
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

/**
 * Install the bridge: register the `/rdagent` prefix route.
 * @param ctx - Cordis context with `webServer`.
 * @param config - validated plugin configuration.
 * @returns the route disposer.
 */
export function apply(ctx: Context, config: Config): () => void {
  const logDir = path.resolve(config.logDir)
  const script = config.parseScript || SCRIPT_PATH

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
      sendJson(res, 404, { error: 'not found' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[rdagent-bridge] ${req.method} ${pathname} failed: ${message}`)
      sendJson(res, 500, { error: message })
    }
  }

  return ctx.webServer.register({ kind: 'prefix', path: '/rdagent', handler })
}
