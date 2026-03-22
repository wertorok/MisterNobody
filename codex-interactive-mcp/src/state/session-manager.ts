import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { logger } from '../utils/logger.js'
import {
  MAX_ACTIVE_SESSIONS,
  PREVIOUS_SUMMARY_MAX_CHARS,
} from '../config.js'
import type {
  SessionState,
  DecisionLogEntry,
  CacheRule,
} from '../core/types.js'
import {
  MaxSessionsExceededError,
  SessionNotFoundError,
  WorkingDirError,
} from '../core/types.js'

// ─── Session directory management ─────────────────────────────────────────────

const SESSIONS_DIR = './sessions'

export function getSessionDir(sessionId: string): string {
  return path.join(SESSIONS_DIR, sessionId)
}

function ensureSessionsDir(): void {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true })
}

// ─── Atomic session state write ───────────────────────────────────────────────

export async function saveSessionState(
  state: SessionState,
  dir: string
): Promise<void> {
  state.updated_at = new Date().toISOString()
  const tmpPath = path.join(dir, `session.json.tmp.${Date.now()}`)
  const finalPath = path.join(dir, 'session.json')
  await fs.promises.writeFile(tmpPath, JSON.stringify(state, null, 2))
  await fs.promises.rename(tmpPath, finalPath) // atomic on most FS
}

export function loadSessionState(dir: string): SessionState | null {
  const filePath = path.join(dir, 'session.json')
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as SessionState
  } catch {
    return null
  }
}

// ─── Decision log ─────────────────────────────────────────────────────────────

export async function appendDecisionLog(
  dir: string,
  entry: DecisionLogEntry
): Promise<void> {
  const logPath = path.join(dir, 'decisions.log')
  const line = JSON.stringify(entry) + '\n'
  await fs.promises.appendFile(logPath, line, 'utf-8')
}

export function readDecisionLog(dir: string): DecisionLogEntry[] {
  const logPath = path.join(dir, 'decisions.log')
  try {
    const raw = fs.readFileSync(logPath, 'utf-8')
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as DecisionLogEntry)
  } catch {
    return []
  }
}

// ─── Previous summary generation (template-based, no LLM) ────────────────────

export function generatePreviousSummary(
  state: SessionState,
  decisions: DecisionLogEntry[]
): string {
  const touchedFiles = [
    ...new Set(
      decisions
        .filter((d) => d.response === 'y' && d.request.target_kind === 'path')
        .map((d) => d.request.normalized_target)
    ),
  ]

  const pendingSteps = state.plan.filter(
    (s) => !state.completed_steps.includes(s)
  )

  const parts = [
    `Task: ${state.task}`,
    `Completed steps: ${state.completed_steps.join(', ') || 'none'}`,
    `Pending steps: ${pendingSteps.join(', ') || 'none'}`,
    touchedFiles.length > 0
      ? `Files touched: ${touchedFiles.join(', ')}`
      : '',
    state.pending_request
      ? `Last blocker: ${state.pending_request.action} on ${state.pending_request.normalized_target}`
      : '',
    `Status at interruption: ${state.runtime_state}`,
  ].filter(Boolean)

  // ~1200 tokens ≈ 4800 characters
  return parts.join('\n').slice(0, PREVIOUS_SUMMARY_MAX_CHARS)
}

// ─── Effective prompt for recovery ───────────────────────────────────────────

export function buildEffectivePrompt(
  task: string,
  previous_summary?: string
): string {
  if (!previous_summary) return task
  return [
    'Previous interrupted session summary:',
    previous_summary,
    '',
    'Continue the task carefully from the current workspace state.',
    '',
    'Original task:',
    task,
  ]
    .join('\n')
    .trim()
}

// ─── Session Manager ──────────────────────────────────────────────────────────

export class SessionManager {
  // In-memory state for active sessions (NOT for reattach)
  private activeSessions = new Map<string, SessionState>()

  constructor() {
    ensureSessionsDir()
    this.recoverInterruptedSessions()
  }

  private recoverInterruptedSessions(): void {
    try {
      const dirs = fs.readdirSync(SESSIONS_DIR)
      for (const dir of dirs) {
        const fullDir = path.join(SESSIONS_DIR, dir)
        const state = loadSessionState(fullDir)
        if (!state) continue

        if (state.schema_version !== 1) {
          logger.warn(
            `Session ${state.session_id}: schema_version mismatch (${state.schema_version})`
          )
        }

        // Mark running sessions as interrupted (we can't reattach after restart)
        if (
          state.status === 'running' ||
          state.status === 'started'
        ) {
          state.status = 'interrupted'
          state.runtime_state = 'interrupted'
          // Clear session-scope cache rules
          state.approved_patterns = state.approved_patterns.filter(
            (r) => r.scope !== 'session'
          )
          void saveSessionState(state, fullDir)
          logger.info(`Session ${state.session_id} marked as interrupted`)
        }
      }
    } catch {
      // SESSIONS_DIR might not exist yet
    }
  }

  createSession(opts: {
    task: string
    plan: string[]
    working_dir?: string
    task_lineage_id?: string
    previous_summary?: string
  }): SessionState {
    if (this.activeSessions.size >= MAX_ACTIVE_SESSIONS) {
      throw new MaxSessionsExceededError(MAX_ACTIVE_SESSIONS)
    }

    const workingDir = opts.working_dir ?? process.cwd()

    // Validate working_dir
    if (!path.isAbsolute(workingDir)) {
      throw new WorkingDirError(workingDir)
    }
    if (!fs.existsSync(workingDir)) {
      throw new WorkingDirError(workingDir)
    }

    const session_id = crypto.randomUUID()
    const task_lineage_id = opts.task_lineage_id ?? crypto.randomUUID()
    const now = new Date().toISOString()

    const state: SessionState = {
      schema_version: 1,
      session_id,
      task_lineage_id,
      task: opts.task,
      plan: opts.plan,
      status: 'started',
      runtime_state: 'active',
      approved_patterns: [],
      completed_steps: [],
      previous_summary: opts.previous_summary,
      started_at: now,
      updated_at: now,
      working_dir: workingDir,
      recent_request_timestamps: [], // NOT persisted — memory only
    }

    // Load task-scope rules from previous session if recovering
    if (opts.task_lineage_id) {
      state.approved_patterns = this.loadTaskScopeRules(opts.task_lineage_id)
    }

    // Create session directory
    const dir = getSessionDir(session_id)
    fs.mkdirSync(dir, { recursive: true })
    fs.mkdirSync(path.join(dir, 'cycles'), { recursive: true })

    void saveSessionState(state, dir)
    this.activeSessions.set(session_id, state)

    logger.info(`Session created: ${session_id} (lineage: ${task_lineage_id})`)
    return state
  }

  private loadTaskScopeRules(taskLineageId: string): CacheRule[] {
    const rules: CacheRule[] = []
    try {
      const dirs = fs.readdirSync(SESSIONS_DIR)
      for (const dir of dirs) {
        const state = loadSessionState(path.join(SESSIONS_DIR, dir))
        if (
          state &&
          state.task_lineage_id === taskLineageId &&
          state.approved_patterns.length > 0
        ) {
          rules.push(
            ...state.approved_patterns.filter((r) => r.scope === 'task')
          )
        }
      }
    } catch {
      // ignore
    }
    return rules
  }

  getSession(sessionId: string): SessionState {
    const state = this.activeSessions.get(sessionId)
    if (!state) throw new SessionNotFoundError(sessionId)
    return state
  }

  getSessionOrNull(sessionId: string): SessionState | null {
    return this.activeSessions.get(sessionId) ?? null
  }

  getLatestSession(): SessionState | null {
    let latest: SessionState | null = null
    for (const state of this.activeSessions.values()) {
      if (!latest || state.updated_at > latest.updated_at) {
        latest = state
      }
    }
    return latest
  }

  getActiveSessions(): SessionState[] {
    return [...this.activeSessions.values()]
  }

  async updateSession(state: SessionState): Promise<void> {
    this.activeSessions.set(state.session_id, state)
    const dir = getSessionDir(state.session_id)
    await saveSessionState(state, dir)
  }

  async endSession(
    sessionId: string,
    status: 'completed' | 'interrupted' | 'error'
  ): Promise<void> {
    const state = this.activeSessions.get(sessionId)
    if (!state) return

    const dir = getSessionDir(sessionId)
    const decisions = readDecisionLog(dir)
    const summary = generatePreviousSummary(state, decisions)

    state.status = status
    state.runtime_state =
      status === 'completed' ? 'completed' : 'interrupted'
    state.previous_summary = summary

    // Keep only task-scope rules in persisted state
    state.approved_patterns = state.approved_patterns.filter(
      (r) => r.scope === 'task'
    )

    await saveSessionState(state, dir)
    this.activeSessions.delete(sessionId)
    logger.info(`Session ${sessionId} ended: ${status}`)
  }
}

export const sessionManager = new SessionManager()
