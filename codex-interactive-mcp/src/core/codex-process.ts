import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { execSync } from 'child_process'
import treeKill from 'tree-kill'
import { logger } from '../utils/logger.js'
import { TREE_KILL_GRACE_MS } from '../config.js'
import type { StreamEvent } from './types.js'
import { StreamParser } from './stream-parser.js'

// ─── Process lifecycle ────────────────────────────────────────────────────────

export interface CodexProcessOptions {
  task: string
  workingDir: string
  approvalMode?: 'on-request' | 'never'
  model?: string
  onEvent: (event: StreamEvent) => void
}

export interface CodexProcessHandle {
  pid: number
  stdin: NodeJS.WritableStream
  parser: StreamParser
  kill: () => Promise<void>
  waitForExit: () => Promise<{ code: number | null; signal: string | null }>
}

function resolveCodexBin(): { cmd: string; prefix: string[] } {
  try {
    execSync('which codex', { stdio: 'pipe' })
    return { cmd: 'codex', prefix: [] }
  } catch {
    return { cmd: 'npx', prefix: ['@openai/codex'] }
  }
}

export function spawnCodex(opts: CodexProcessOptions): CodexProcessHandle {
  const bin = resolveCodexBin()
  const approval = opts.approvalMode ?? 'on-request'

  const args: string[] = [
    ...bin.prefix,
    'exec',
    '--json',
    '-a',
    approval,
    '--skip-git-repo-check',
  ]

  if (opts.model) {
    args.push('-m', opts.model)
  }

  args.push(opts.task)

  logger.info(`Spawning Codex: ${bin.cmd} ${args.join(' ')}`)

  const child: ChildProcess = spawn(bin.cmd, args, {
    cwd: opts.workingDir,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const parser = new StreamParser()
  parser.on('event', opts.onEvent)
  parser.attach(child)

  // ── Exit handler (MANDATORY per constraint #7) ────────────────────────────
  // Must work for ALL runtime states, including awaiting_permission.
  let exitResolve: (v: { code: number | null; signal: string | null }) => void
  let forceKillTimeout: ReturnType<typeof setTimeout> | null = null

  const exitPromise = new Promise<{ code: number | null; signal: string | null }>(
    (resolve) => {
      exitResolve = resolve
    }
  )

  child.on('exit', (code, signal) => {
    if (forceKillTimeout) {
      clearTimeout(forceKillTimeout)
      forceKillTimeout = null
    }
    logger.info(
      `Codex process exited: code=${code}, signal=${signal}, pid=${child.pid}`
    )
    exitResolve({ code, signal })
  })

  child.on('error', (err) => {
    logger.error(`Codex process error: ${err.message}`)
    if (child.pid) {
      treeKill(child.pid, 'SIGKILL')
    }
  })

  const pid = child.pid ?? -1

  async function kill(): Promise<void> {
    return killProcessTree(pid)
  }

  function waitForExit(): Promise<{ code: number | null; signal: string | null }> {
    return exitPromise
  }

  return {
    pid,
    stdin: child.stdin!,
    parser,
    kill,
    waitForExit,
  }
}

// ─── Tree kill ────────────────────────────────────────────────────────────────
// Codex CLI spawns child processes (git, npm, tsc, compilers, linters).
// Regular kill() only kills the parent — children become zombies.
// On a long-running MCP server this leads to OOM.

export async function killProcessTree(pid: number): Promise<void> {
  if (pid <= 0) return

  return new Promise((resolve) => {
    treeKill(pid, 'SIGTERM', (err) => {
      if (err) {
        // Process already dead or no permissions — not an error
        logger.warn(`tree-kill SIGTERM failed for pid ${pid}: ${err.message}`)
        return resolve()
      }

      // Wait TREE_KILL_GRACE_MS, then SIGKILL if still alive
      const forceKillTimeout = setTimeout(() => {
        treeKill(pid, 'SIGKILL', () => resolve())
      }, TREE_KILL_GRACE_MS)

      // Check if process is already gone
      try {
        process.kill(pid, 0) // 0 = check if process exists
      } catch {
        // Process already dead
        clearTimeout(forceKillTimeout)
        return resolve()
      }
    })
  })
}
