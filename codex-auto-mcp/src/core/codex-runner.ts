import { spawn } from 'child_process'
import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { stripAnsi } from '../utils/strip-ansi.js'
import { logger } from '../utils/logger.js'

export type FailureKind =
  | 'timeout'
  | 'cli_not_found'
  | 'missing_api_key'
  | 'process_crash'
  | 'nonzero_exit'
  | 'filesystem_violation'
  | 'snapshot_too_large'

export interface RunResult {
  stdout: string
  stderr: string
  exit_code: number
  success: boolean
  duration_ms: number
  failure_kind?: FailureKind
}

export const SNAPSHOT_IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.venv',
  'venv',
  '__pycache__',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.cache',
  'coverage',
  '.nyc_output',
  '.tox',
  'target',
])

const SNAPSHOT_MAX_FILES = 50_000

export interface RunOptions {
  prompt: string
  model?: string
  working_dir?: string
  timeout_ms?: number
  approval?: 'never' | 'on-request' | 'full-auto'
}

function classifyFailure(
  error: unknown,
  exitCode: number | null,
  stderr: string
): FailureKind {
  if (error instanceof Error && error.name === 'AbortError') return 'timeout'
  if (stderr.includes('command not found') || stderr.includes('No such file'))
    return 'cli_not_found'
  if (stderr.includes('API key') || stderr.includes('OPENAI_API_KEY'))
    return 'missing_api_key'
  if ((exitCode ?? 0) !== 0 && !error) return 'nonzero_exit'
  return 'process_crash'
}

export async function runCodex(opts: RunOptions): Promise<RunResult> {
  const startTime = Date.now()
  const workingDir = opts.working_dir ?? process.cwd()
  const timeoutMs = opts.timeout_ms ?? 120_000

  const args: string[] = ['exec', '--json']

  if (opts.approval === 'full-auto') {
    args.push('--full-auto')
  } else if (opts.approval === 'never') {
    args.push('-a', 'never')
  } else {
    args.push('-a', 'on-request')
  }

  args.push('--skip-git-repo-check')

  if (opts.model) {
    args.push('-m', opts.model)
  }

  args.push(opts.prompt)

  const codexBin = resolveCodexBin()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  return new Promise((resolve) => {
    let stdoutBuf = ''
    let stderrBuf = ''
    let finished = false

    const child = spawn(codexBin.cmd, [...codexBin.prefix, ...args], {
      cwd: workingDir,
      env: { ...process.env },
      signal: controller.signal,
    })

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString()
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString()
    })

    child.on('error', (err) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      const duration_ms = Date.now() - startTime
      resolve({
        stdout: stripAnsi(stdoutBuf),
        stderr: stripAnsi(stderrBuf),
        exit_code: -1,
        success: false,
        duration_ms,
        failure_kind: classifyFailure(err, null, stderrBuf),
      })
    })

    child.on('exit', (code, signal) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      const duration_ms = Date.now() - startTime
      const exitCode = code ?? -1
      const success = exitCode === 0
      resolve({
        stdout: stripAnsi(stdoutBuf),
        stderr: stripAnsi(stderrBuf),
        exit_code: exitCode,
        success,
        duration_ms,
        failure_kind: success
          ? undefined
          : signal === 'SIGTERM' || signal === 'SIGABRT'
            ? 'timeout'
            : classifyFailure(null, exitCode, stderrBuf),
      })
    })
  })
}

function resolveCodexBin(): { cmd: string; prefix: string[] } {
  try {
    execSync('which codex', { stdio: 'pipe' })
    return { cmd: 'codex', prefix: [] }
  } catch {
    return { cmd: 'npx', prefix: ['@openai/codex'] }
  }
}

// ──────────────────────────────────────────────────────────
// Filesystem integrity helpers for codex_ask (no-write semantics)
// ──────────────────────────────────────────────────────────

type IntegrityMethod = 'git' | 'snapshot'

export function chooseIntegrityChecker(workingDir: string): IntegrityMethod {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd: workingDir,
      timeout: 1000,
      stdio: 'pipe',
    })
    return 'git'
  } catch {
    return 'snapshot'
  }
}

export function gitStatusBefore(workingDir: string): string {
  try {
    return execSync('git status --porcelain -uall', {
      cwd: workingDir,
      timeout: 2000,
      encoding: 'utf-8',
    })
  } catch {
    return ''
  }
}

export function gitStatusAfter(
  workingDir: string
): { changed: boolean; details: string } {
  try {
    const after = execSync('git status --porcelain -uall', {
      cwd: workingDir,
      timeout: 2000,
      encoding: 'utf-8',
    })
    return { changed: false, details: after }
  } catch {
    return { changed: false, details: '' }
  }
}

export function detectGitChanges(
  before: string,
  after: string
): string[] {
  if (before === after) return []
  const beforeLines = new Set(before.split('\n').filter(Boolean))
  const afterLines = after.split('\n').filter(Boolean)
  return afterLines.filter((l) => !beforeLines.has(l))
}

interface SnapshotEntry {
  mtime: number
  size: number
}

export async function captureSnapshot(
  dir: string,
  ignoreDirs: Set<string>
): Promise<{ snapshot: Map<string, SnapshotEntry>; tooLarge: boolean }> {
  const snapshot = new Map<string, SnapshotEntry>()

  // Parse .gitignore if exists
  const extraIgnore = new Set<string>()
  try {
    const gi = fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8')
    for (const line of gi.split('\n')) {
      const trimmed = line.trim().replace(/\/$/, '')
      if (trimmed && !trimmed.startsWith('#')) {
        extraIgnore.add(trimmed)
      }
    }
  } catch {
    // no .gitignore
  }

  const combined = new Set([...ignoreDirs, ...extraIgnore])

  async function walk(current: string): Promise<boolean> {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return false
    }

    for (const entry of entries) {
      if (combined.has(entry.name)) continue
      const full = path.join(current, entry.name)
      const rel = path.relative(dir, full)

      if (entry.isDirectory()) {
        const tooLarge = await walk(full)
        if (tooLarge) return true
      } else if (entry.isFile()) {
        if (snapshot.size >= SNAPSHOT_MAX_FILES) return true
        try {
          const stat = fs.statSync(full)
          snapshot.set(rel, { mtime: stat.mtimeMs, size: stat.size })
        } catch {
          // skip
        }
      }
    }
    return false
  }

  const tooLarge = await walk(dir)
  return { snapshot, tooLarge }
}

export async function detectSnapshotChanges(
  dir: string,
  snapshot: Map<string, SnapshotEntry>,
  ignoreDirs: Set<string>
): Promise<string[]> {
  const changes: string[] = []

  async function walk(current: string): Promise<void> {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (ignoreDirs.has(entry.name)) continue
      const full = path.join(current, entry.name)
      const rel = path.relative(dir, full)

      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        const before = snapshot.get(rel)
        if (!before) {
          changes.push(rel)
        } else {
          try {
            const stat = fs.statSync(full)
            if (stat.mtimeMs !== before.mtime || stat.size !== before.size) {
              changes.push(rel)
            }
          } catch {
            // skip
          }
        }
      }
    }
  }

  // Check for deleted files
  for (const rel of snapshot.keys()) {
    const full = path.join(dir, rel)
    if (!fs.existsSync(full)) {
      changes.push(rel)
    }
  }

  await walk(dir)
  return changes
}

logger.debug('codex-runner loaded')
