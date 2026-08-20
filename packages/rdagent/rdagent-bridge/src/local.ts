/**
 * Local quant-experiment adapter: reads `experiments/<name>/` trees (the
 * quant-experiment project layout) into the unified experiment model.
 * Pure Node, no Python: manifests are parsed defensively (standard JSON or
 * JSONL), metric files are shape-dispatched, and text files are decoded with
 * BOM sniffing then UTF-8-strict then GB18030 fallback.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

/** One run entity inside a local experiment (exp1s-style manifests). */
export interface LocalRun {
  id: string
  startedAt?: string
  durationSec?: number
  status?: string
  meta: Record<string, unknown>
}

/** One experiment-scoped artifact (exp1/exp2/exp3-style products). */
export interface LocalArtifact {
  label: string
  kind: 'series' | 'table' | 'report' | 'model' | 'binary' | 'log'
  path: string
  size?: number
}

/** One local experiment. */
export interface LocalExperiment {
  name: string
  runs: LocalRun[]
  artifacts: LocalArtifact[]
  warnings: string[]
}

/** Limits guarding reads against oversized or pathological files. */
export const LIMITS = {
  manifestBytes: 2 * 1024 * 1024,
  jsonBytes: 2 * 1024 * 1024,
  textBytes: 100 * 1024,
  maxExperiments: 50,
  scanDepth: 3,
} as const

/** Decode a buffer with BOM sniffing, strict UTF-8, then GB18030 fallback. */
export function decodeText(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer)
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer)
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    try {
      return new TextDecoder('gb18030').decode(buffer)
    } catch {
      // unreachable in practice: gb18030 decodes any byte sequence
      return new TextDecoder('utf-8').decode(buffer)
    }
  }
}

/** Parse a manifest that is either standard JSON or JSON Lines (header + run rows). */
export function parseManifest(text: string): { header: Record<string, unknown>; runs: Record<string, unknown>[]; warnings: string[] } {
  const warnings: string[] = []
  const header: Record<string, unknown> = {}
  const runs: Record<string, unknown>[] = []
  const trimmed = text.trim()
  if (trimmed === '') return { header, runs, warnings }

  // Standard JSON first (exp2/exp3 shape): whole document, `runs` key optional.
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>
      for (const [k, v] of Object.entries(record)) {
        if (k === 'runs') {
          if (Array.isArray(v)) {
            for (const row of v) {
              if (typeof row === 'object' && row !== null) runs.push(row as Record<string, unknown>)
            }
          }
        } else {
          header[k] = v
        }
      }
      return { header, runs, warnings }
    }
  } catch {
    // fall through to JSONL
  }

  // JSONL (exp1s shape): header line(s) without run_id, then one run per line.
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const trimmedLine = line.trim()
    if (trimmedLine === '') continue
    try {
      const row: unknown = JSON.parse(trimmedLine)
      if (typeof row === 'object' && row !== null) {
        const record = row as Record<string, unknown>
        if (typeof record.run_id === 'string') runs.push(record)
        else Object.assign(header, record)
      }
    } catch {
      warnings.push(`line ${index + 1}: unparsable manifest row skipped`)
    }
  }
  return { header, runs, warnings }
}

/** Normalize a date-ish key (drop the ` 00:00:00` suffix) or return null. */
function normalizeDateKey(key: string): string | null {
  const k = key.trim().replace(/ 00:00:00$/, '')
  if (/^\d{4}-\d{2}-\d{2}/.test(k)) return k
  return null
}

/** Shape-dispatched series extraction from one parsed JSON document. */
export function extractSeries(content: Record<string, unknown>): { label: string; dates: string[]; values: number[] }[] {
  const out: { label: string; dates: string[]; values: number[] }[] = []

  // Columnar shape (exp2 daily_series): { series: { date: [...], <col>: [...] } }.
  const series = content.series
  if (typeof series === 'object' && series !== null) {
    const columns = series as Record<string, unknown>
    const dates = Array.isArray(columns.date) ? columns.date.map(d => String(d)) : []
    for (const [key, value] of Object.entries(columns)) {
      if (key === 'date' || !Array.isArray(value)) continue
      const values = value.map(v => (typeof v === 'number' && Number.isFinite(v) ? v : NaN))
      if (values.length > 0) out.push({ label: key, dates, values })
    }
    return out
  }

  // Map shape: { <name>: { "<date>": number, ... } } (exp1s m3_*_ic, exp3 *_ic).
  for (const [key, value] of Object.entries(content)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const dates: string[] = []
    const values: number[] = []
    let numeric = true
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const date = normalizeDateKey(k)
      if (date === null || typeof v !== 'number' || !Number.isFinite(v)) {
        numeric = false
        break
      }
      dates.push(date)
      values.push(v)
    }
    if (numeric && dates.length > 0) out.push({ label: key, dates, values })
  }
  if (out.length > 0) return out

  // Bare array shape (exp1 final_eval ic_series): index axis.
  const bare = content.ic_series
  if (Array.isArray(bare)) {
    const values = bare.map(v => (typeof v === 'number' && Number.isFinite(v) ? v : NaN))
    if (values.length > 0) out.push({ label: 'ic_series', dates: values.map((_, i) => String(i)), values })
  }
  return out
}

/** Classify an artifact by name/extension. */
export function artifactKind(name: string): LocalArtifact['kind'] {
  const lower = name.toLowerCase()
  if (lower.endsWith('.json')) return lower.includes('band') || lower.includes('ic') || lower.includes('series') ? 'series' : 'table'
  if (lower.endsWith('.csv')) return 'table'
  if (lower.endsWith('.log')) return 'log'
  if (lower.endsWith('.md') || lower.endsWith('.txt') || lower.endsWith('.diff')) return 'report'
  if (lower.endsWith('.pth') || lower.endsWith('.npz')) return 'model'
  if (lower.endsWith('.npy')) return 'binary'
  return 'binary'
}

/** Read a file's content under the size limit (text kinds), else null. */
export async function readTextFile(filePath: string, limit = LIMITS.textBytes): Promise<string | null> {
  const info = await stat(filePath)
  if (info.size > limit) return null
  const buffer = await readFile(filePath)
  return decodeText(buffer)
}

/** One file entry inside a run directory. */
export interface RunFile {
  path: string
  size: number
  kind: LocalArtifact['kind']
}

/** List the files inside one run directory (recursive, size-guarded). */
export async function listRunFiles(root: string, exp: string, runId: string): Promise<RunFile[]> {
  const runDir = path.join(root, exp, 'runs', runId)
  const entries = await readdir(runDir, { withFileTypes: true, recursive: true }).catch(() => [])
  const files: RunFile[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const rel = path.relative(runDir, path.join(entry.parentPath, entry.name)).replace(/\\/g, '/')
    const size = (await stat(path.join(runDir, rel)).catch(() => null))?.size
    if (size === undefined) continue
    files.push({ path: rel, size, kind: artifactKind(entry.name) })
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1))
  return files
}

/** List one experiment directory: manifest runs (when present) + artifacts. */
async function scanExperiment(root: string, name: string, depth: number): Promise<LocalExperiment | null> {
  const dir = path.join(root, name)
  const warnings: string[] = []
  const runs: LocalRun[] = []
  const artifacts: LocalArtifact[] = []

  const manifestPath = path.join(dir, 'manifest.json')
  try {
    const info = await stat(manifestPath)
    if (info.size <= LIMITS.manifestBytes) {
      const parsed = parseManifest(await readFile(manifestPath, 'utf8'))
      warnings.push(...parsed.warnings)
      for (const row of parsed.runs) {
        const id = typeof row.run_id === 'string' ? row.run_id : ''
        if (id === '') continue
        const run: LocalRun = { id, meta: row }
        if (typeof row.secs === 'number') run.durationSec = row.secs
        if (typeof row.moved === 'boolean') run.status = row.moved ? 'moved' : 'in-place'
        runs.push(run)
      }
    }
  } catch {
    // no manifest: pure artifact experiment (exp1 shape)
  }

  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    // runs/ holds per-run entities (exp1s); everything else is artifact space.
    if (entry.name === 'runs') {
      const runsDir = path.join(dir, 'runs')
      const runEntries = await readdir(runsDir, { withFileTypes: true }).catch(() => [])
      for (const runEntry of runEntries) {
        if (!runEntry.isDirectory()) continue
        const id = runEntry.name
        const info = await stat(path.join(runsDir, id)).catch(() => null)
        if (runs.some(r => r.id === id)) continue
        const run: LocalRun = { id, meta: {} }
        if (info !== null) run.startedAt = info.mtime.toISOString()
        runs.push(run)
      }
      continue
    }
    if (depth >= LIMITS.scanDepth) continue
    const artifactDir = path.join(dir, entry.name)
    const files = await readdir(artifactDir, { withFileTypes: true }).catch(() => [])
    for (const file of files) {
      if (!file.isFile()) continue
      const artifact: LocalArtifact = {
        label: `${entry.name}/${file.name}`,
        kind: artifactKind(file.name),
        path: path.join(entry.name, file.name).replace(/\\/g, '/'),
      }
      const size = (await stat(path.join(artifactDir, file.name)).catch(() => null))?.size
      if (size !== undefined) artifact.size = size
      artifacts.push(artifact)
    }
  }

  return { name, runs, artifacts, warnings }
}

/** mtime-keyed tree cache: root plus per-experiment directory mtimes must all
 * match for a hit (an appended manifest row changes the experiment dir mtime). */
const treeCache = new Map<string, { mtimeMs: number; dirMtimes: number[]; data: { experiments: LocalExperiment[] } }>()

/** Build the local experiment tree under `experimentsRoot` (mtime-cached). */
export async function buildLocalTree(root: string): Promise<{ experiments: LocalExperiment[] }> {
  const rootInfo = await stat(root)
  const entries = await readdir(root, { withFileTypes: true })
  const dirMtimes: number[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const info = await stat(path.join(root, entry.name)).catch(() => null)
    if (info !== null) dirMtimes.push(info.mtimeMs)
  }
  dirMtimes.sort((a, b) => a - b)
  const cached = treeCache.get(root)
  if (cached !== undefined && cached.mtimeMs === rootInfo.mtimeMs && cached.dirMtimes.length === dirMtimes.length
    && cached.dirMtimes.every((v, i) => v === dirMtimes[i])) {
    return cached.data
  }
  const experiments: LocalExperiment[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || experiments.length >= LIMITS.maxExperiments) continue
    if (entry.name.startsWith('.')) continue
    const experiment = await scanExperiment(root, entry.name, 1)
    if (experiment !== null) experiments.push(experiment)
  }
  experiments.sort((a, b) => (a.name < b.name ? -1 : 1))
  const data = { experiments }
  treeCache.set(root, { mtimeMs: rootInfo.mtimeMs, dirMtimes, data })
  return data
}
