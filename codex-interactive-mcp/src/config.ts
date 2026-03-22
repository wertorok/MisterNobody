// ─── Runtime constants — determined by Step 0 result ─────────────────────────
//
// Step 0 result: codex exec supports --json JSONL output via pipe.
// CLI_MODE = 'pipe'

export type CliMode = 'pipe' | 'pty'

// Set to 'pty' if Step 0 shows TUI mode
export const CLI_MODE: CliMode = 'pipe'

// ─── Session limits ───────────────────────────────────────────────────────────
export const MAX_ACTIVE_SESSIONS = 3
export const SESSION_TIMEOUT_MS = 600_000 // 10 minutes

// ─── Write timeouts ───────────────────────────────────────────────────────────
export const SAFE_WRITE_TIMEOUT_MS = 5_000

// ─── WaitingHeuristic ────────────────────────────────────────────────────────
export const IDLE_THRESHOLD_MS = 2_500

// ─── Buffer ───────────────────────────────────────────────────────────────────
export const BUFFER_MAX_BYTES = 5 * 1024 * 1024 // 5 MB → rotate

// ─── codex_ask ────────────────────────────────────────────────────────────────
export const SNAPSHOT_MAX_FILES = 50_000

// ─── Rate limiting ────────────────────────────────────────────────────────────
export const RATE_LIMIT_WINDOW_SEC = 30
export const RATE_LIMIT_MAX_REQUESTS = 20

// ─── Session state persistence ────────────────────────────────────────────────
export const PREVIOUS_SUMMARY_MAX_CHARS = 4_800 // ≈ 1200 tokens

// ─── Stream parser ────────────────────────────────────────────────────────────
// 50ms is too short — on a busy system a chunk can arrive 40-60ms late.
export const LINE_FLUSH_DEBOUNCE_MS = 150

// ─── Process management ───────────────────────────────────────────────────────
export const TREE_KILL_GRACE_MS = 5_000 // SIGTERM → wait → SIGKILL

// ─── WaitingHeuristic thresholds (depend on CLI_MODE) ────────────────────────
// PTY mode: -0.1 because source discrimination is unavailable
export const WAITING_CONFIDENCE_THRESHOLD = CLI_MODE === 'pipe' ? 0.5 : 0.4
