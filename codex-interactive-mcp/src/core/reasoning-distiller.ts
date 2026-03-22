import type { Buffer, BufferEntry } from './buffer.js'
import type {
  SummaryPackage,
  PermissionRequest,
  SecurityVerdictResult,
  SessionState,
} from './types.js'
import { logger } from '../utils/logger.js'

// ─── Reasoning Distiller ──────────────────────────────────────────────────────
// Converts the buffer for the current approval cycle into a SummaryPackage
// for Claude to reason about.
//
// CRITICAL: Claude receives reasoning_chunk by default.
// Do NOT reduce the view to last 10-15 lines.
// If chunk is too large — compress semantically via buffer.compress().

const MAX_SUMMARY_LINES = 500 // ~10k tokens, semantic compression above this
const FILE_PATTERN =
  /(?:^|[\s'"`])(?:\.?\.?\/)?[\w.\-/]+\.(ts|js|tsx|jsx|json|py|rs|go|yaml|yml|toml|sql|prisma|md|txt|css|html|sh|env|lock|config)\b/g

const ERROR_PATTERN =
  /\b(error|err|fail(?:ed)?|exception|panic|fatal|warning|cannot|could not|unable to)\b/i

const ACTION_PATTERN =
  /\b(creat(?:ing|ed)|modif(?:y|ying|ied)|delet(?:ing|ed)|run(?:ning)?|execut(?:ing|ed)|install(?:ing|ed)|build(?:ing)?|test(?:ing)?|generat(?:ing|ed))\b/i

export interface DistillOptions {
  maxSummaryTokens?: number // approximate, default 1500
  cycleId: string
  rawChunkPath: string
}

export function distill(
  buf: Buffer,
  request: PermissionRequest,
  verdict: SecurityVerdictResult,
  state: SessionState,
  opts: DistillOptions
): SummaryPackage {
  const allEntries = buf.getMerged()
  const totalLines = allEntries.length

  const maxLines = Math.floor((opts.maxSummaryTokens ?? 1500) * 0.8) // tokens → approx lines
  const effectiveMax = Math.min(MAX_SUMMARY_LINES, maxLines)

  let usedEntries: BufferEntry[]
  let truncated = false

  if (totalLines > effectiveMax) {
    usedEntries = buf.compress(effectiveMax)
    truncated = true
    logger.debug(
      `reasoning-distiller: compressed ${totalLines} → ${usedEntries.length} lines`
    )
  } else {
    usedEntries = allEntries
  }

  const reasoningChunk = usedEntries.map((e) => e.text).join('\n')

  // Extract files mentioned in reasoning
  const filesMentioned = extractFilesMentioned(reasoningChunk)

  // Extract files confirmed touched (actions that were approved)
  const filesTouched = extractFilesTouched(allEntries)

  // Extract errors
  const errorsSeen = extractErrors(allEntries)

  // Extract recent actions
  const recentActions = extractRecentActions(allEntries)

  return {
    recent_actions: recentActions,
    files_mentioned: filesMentioned,
    files_touched: filesTouched,
    errors_seen: errorsSeen,
    reasoning_chunk: reasoningChunk,
    reasoning_chunk_truncated: truncated,
    permission_request: request,
    security_verdict: verdict,
    session_context: {
      task: state.task,
      plan: state.plan,
      completed_steps: state.completed_steps,
    },
    raw_chunk_available: true,
    cycle_id: opts.cycleId,
  }
}

function extractFilesMentioned(text: string): string[] {
  const matches = new Set<string>()
  let m: RegExpExecArray | null
  const re = new RegExp(FILE_PATTERN.source, 'g')
  while ((m = re.exec(text)) !== null) {
    const raw = (m[0] ?? '').trim().replace(/^['"`]|['"`]$/g, '')
    if (raw) matches.add(raw)
  }
  return [...matches]
}

function extractFilesTouched(entries: BufferEntry[]): string[] {
  // "Touched" means confirmed create/modify/delete action in the buffer
  const touched = new Set<string>()
  const touchedPattern =
    /(?:created|wrote|modified|edited|deleted|removed)\s+(?:file\s+)?(['"`]?)([^\s'"`]+\.[a-zA-Z]+)\1/i

  for (const entry of entries) {
    const m = touchedPattern.exec(entry.text)
    if (m) {
      const file = m[2] ?? ''
      if (file) touched.add(file)
    }
  }
  return [...touched]
}

function extractErrors(entries: BufferEntry[]): string[] {
  return entries
    .filter((e) => ERROR_PATTERN.test(e.text))
    .map((e) => e.text)
    .slice(-10) // last 10 errors
}

function extractRecentActions(entries: BufferEntry[]): string[] {
  return entries
    .filter((e) => ACTION_PATTERN.test(e.text))
    .map((e) => e.text)
    .slice(-20) // last 20 actions
}
