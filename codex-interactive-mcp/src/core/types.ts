// ─── Core Types ───────────────────────────────────────────────────────────────
// All other modules are built on these types.

export type PermissionAction =
  | 'create_file'
  | 'modify_file'
  | 'delete_file'
  | 'run_command'
  | 'unknown'

export interface PermissionRequest {
  raw: string // original string (logging only)
  action: PermissionAction // normalized action type
  target: string // original target from CLI
  target_kind: 'path' | 'command' | 'unknown'
  normalized_target: string // result of normalizeRequest()
  fingerprint: string // hash(action + normalized_target)
}

export interface CacheRule {
  action: PermissionAction // inherited from PermissionRequest, not manually set
  matcher_type: 'glob' | 'exact'
  pattern: string // normalized pattern
  scope: 'session' | 'task'
  task_lineage_id: string // which task lineage this rule belongs to
  approved_by: 'claude'
  created_at: string
  use_count: number
}

export interface SessionState {
  schema_version: 1

  session_id: string
  task_lineage_id: string // same for all recovery sessions of one task
  task: string
  plan: string[]

  status: 'started' | 'running' | 'completed' | 'interrupted' | 'error'

  runtime_state:
    | 'active'
    | 'awaiting_permission'
    | 'awaiting_recovery_decision'
    | 'completed'
    | 'interrupted'
    | 'error'

  // current pending cycle (if runtime_state === 'awaiting_permission')
  pending_request?: PermissionRequest
  pending_cycle_id?: string

  approved_patterns: CacheRule[]
  completed_steps: string[]

  // for recovery
  previous_summary?: string // compact, <= 1200 tokens

  // meta
  process_pid?: number // informational only, NOT for reattach
  started_at: string
  updated_at: string
  working_dir: string // absolute path, validated at creation

  // rate limiting (Security Guard)
  // Stores ISO timestamps of recent permission requests in this session.
  // Security Guard checks: if > 20 in last 30 sec → BLOCK_AND_ALERT.
  // NOT persisted in session.json — lives only in memory (session scope).
  recent_request_timestamps: string[]
}

export interface PermissionCycle {
  cycle_id: string
  session_id: string
  started_at: string
  request: PermissionRequest
  raw_chunk_path: string // path to file with raw buffer for this cycle
  responded_at?: string
  response?: 'y' | 'n'
  response_applied: boolean // idempotency guard
  auto_approved: boolean
}

export type SecurityVerdict = 'AUTO_APPROVE' | 'NEEDS_CLAUDE' | 'BLOCK_AND_ALERT'

export interface SecurityVerdictResult {
  verdict: SecurityVerdict
  reason: string // human-readable justification
  matched_rule?: string // which pattern from security-rules.json matched
}

export interface SummaryPackage {
  recent_actions: string[]
  files_mentioned: string[] // mentioned in reasoning
  files_touched: string[] // actually created/modified/deleted (confirmed)
  errors_seen: string[]
  reasoning_chunk: string // ALL reasoning between previous approval boundary
  // and current permission request
  // if large — semantically compressed, NOT replaced with tail
  reasoning_chunk_truncated: boolean // true if chunk was semantically compressed
  permission_request: PermissionRequest
  security_verdict: SecurityVerdictResult
  session_context: {
    task: string
    plan: string[]
    completed_steps: string[]
  }
  raw_chunk_available: boolean // full raw chunk available via codex_get_raw_chunk
  cycle_id: string
}

export interface DecisionLogEntry {
  timestamp: string
  cycle_id: string
  request: PermissionRequest
  verdict: SecurityVerdict
  response: 'y' | 'n'
  rationale: string // from Claude or "auto-approved by cache rule"
  cache_rule_added?: CacheRule
}

// ─── Stream types ─────────────────────────────────────────────────────────────

// 'pty' is added for PTY mode (see constraint #1, path 2)
export type StreamSource = 'stdout' | 'stderr' | 'pty'

export interface WaitingHeuristic {
  idle_ms: number
  recent_tail: string[]
  last_data_source: StreamSource | null
  saw_question_like_suffix: boolean
  saw_trailing_colon_or_prompt: boolean
  saw_permission_words_without_match: boolean
  combined_confidence: number // 0.0 – 1.0
}

export type StreamEvent =
  | { type: 'line'; text: string; source: StreamSource; timestamp: string }
  | { type: 'permission_candidate'; text: string; timestamp: string }
  | { type: 'task_complete'; summary: string; exit_code: number }
  | { type: 'error'; message: string }
  | { type: 'process_exit'; code: number | null; signal: string | null }
  | { type: 'waiting_for_input'; heuristic: WaitingHeuristic }

// ─── Error classes ────────────────────────────────────────────────────────────

export class CodexNotFoundError extends Error {
  constructor() {
    super('Codex CLI not found. Install with: npm install -g @openai/codex')
    this.name = 'CodexNotFoundError'
  }
}

export class CodexApiKeyMissingError extends Error {
  constructor() {
    super('OPENAI_API_KEY is not set. export OPENAI_API_KEY=sk-...')
    this.name = 'CodexApiKeyMissingError'
  }
}

export class CodexTimeoutError extends Error {
  constructor(ms: number) {
    super(`Codex did not respond within ${ms}ms. Increase timeout_ms.`)
    this.name = 'CodexTimeoutError'
  }
}

export class SessionNotFoundError extends Error {
  constructor(id: string) {
    super(`Session ${id} not found. Use codex_get_state without session_id.`)
    this.name = 'SessionNotFoundError'
  }
}

export class CodexProcessCrashError extends Error {
  constructor(stderr: string) {
    super(`Codex crashed. stderr: ${stderr.slice(0, 500)}`)
    this.name = 'CodexProcessCrashError'
  }
}

export class IdempotencyError extends Error {
  constructor(cycle_id: string) {
    super(`codex_respond already applied for cycle ${cycle_id}`)
    this.name = 'IdempotencyError'
  }
}

export class CacheRuleValidationError extends Error {
  constructor(pattern: string) {
    super(`Pattern "${pattern}" is too broad or forbidden`)
    this.name = 'CacheRuleValidationError'
  }
}

export class MaxSessionsExceededError extends Error {
  constructor(max: number) {
    super(
      `Active session limit reached: ${max}. Finish one of the existing sessions.`
    )
    this.name = 'MaxSessionsExceededError'
  }
}

export class WorkingDirError extends Error {
  constructor(dir: string) {
    super(
      `working_dir must be an absolute path to an existing directory, got: "${dir}"`
    )
    this.name = 'WorkingDirError'
  }
}
