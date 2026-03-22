import * as crypto from 'crypto'
import * as path from 'path'
import type { PermissionRequest, PermissionAction } from './types.js'
import { logger } from '../utils/logger.js'

// ─── Normalization ────────────────────────────────────────────────────────────

export function normalizeRequest(
  request: Omit<PermissionRequest, 'normalized_target' | 'fingerprint'>,
  workingDir: string
): string {
  if (!workingDir || !path.isAbsolute(workingDir)) {
    throw new Error(
      `workingDir must be an absolute path, got: "${workingDir}"`
    )
  }

  if (request.target_kind === 'path') {
    return path
      .resolve(workingDir, request.target)
      .replace(/\\/g, '/')
      .replace(/^"|"$/g, '')
  }

  if (request.target_kind === 'command') {
    // Do NOT apply path.resolve() to commands
    return request.target
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/^['"]|['"]$/g, '')
  }

  return request.target.trim()
}

function makeFingerprint(action: PermissionAction, normalized: string): string {
  return crypto
    .createHash('sha256')
    .update(`${action}:${normalized}`)
    .digest('hex')
    .slice(0, 16)
}

// ─── Pattern definitions ──────────────────────────────────────────────────────
// IMPORTANT: These patterns were designed for codex exec --json JSONL output.
// Approval events in JSONL mode appear as JSON objects with type='approval_request'.
// Text-based patterns serve as fallback for non-JSON lines.

interface PatternDef {
  regex: RegExp
  action: PermissionAction
  target_kind: 'path' | 'command'
  pattern_id: string
}

const PATTERNS: PatternDef[] = [
  // JSON approval_request events (codex exec --json)
  {
    regex: /"action"\s*:\s*"create_file"[^}]*"path"\s*:\s*"([^"]+)"/,
    action: 'create_file',
    target_kind: 'path',
    pattern_id: 'json_create_file',
  },
  {
    regex: /"action"\s*:\s*"write_file"[^}]*"path"\s*:\s*"([^"]+)"/,
    action: 'create_file',
    target_kind: 'path',
    pattern_id: 'json_write_file',
  },
  {
    regex: /"action"\s*:\s*"edit_file"[^}]*"path"\s*:\s*"([^"]+)"/,
    action: 'modify_file',
    target_kind: 'path',
    pattern_id: 'json_edit_file',
  },
  {
    regex: /"action"\s*:\s*"delete_file"[^}]*"path"\s*:\s*"([^"]+)"/,
    action: 'delete_file',
    target_kind: 'path',
    pattern_id: 'json_delete_file',
  },
  {
    regex: /"action"\s*:\s*"shell"[^}]*"command"\s*:\s*"([^"]+)"/,
    action: 'run_command',
    target_kind: 'command',
    pattern_id: 'json_shell',
  },
  {
    regex: /"action"\s*:\s*"exec"[^}]*"command"\s*:\s*"([^"]+)"/,
    action: 'run_command',
    target_kind: 'command',
    pattern_id: 'json_exec',
  },

  // Text-based fallback patterns
  {
    regex: /Allow\s+(?:create\s+file|creating):\s*(.+?)\s*\?/i,
    action: 'create_file',
    target_kind: 'path',
    pattern_id: 'text_create_1',
  },
  {
    regex: /Allow\s+(?:modify|edit)(?:ing)?:\s*(.+?)\s*\?/i,
    action: 'modify_file',
    target_kind: 'path',
    pattern_id: 'text_modify_1',
  },
  {
    regex: /Allow\s+(?:delete|remove)(?:ing)?:\s*(.+?)\s*\?/i,
    action: 'delete_file',
    target_kind: 'path',
    pattern_id: 'text_delete_1',
  },
  {
    regex: /Allow\s+(?:command|run(?:ning)?):\s*(.+?)\s*\?/i,
    action: 'run_command',
    target_kind: 'command',
    pattern_id: 'text_cmd_1',
  },
  {
    regex: /Run\s+(?:command\s+)?(.+?)\s*\?\s*[\(\[]?[yn]/i,
    action: 'run_command',
    target_kind: 'command',
    pattern_id: 'text_cmd_2',
  },
  // Codex exec approval prompt patterns
  {
    regex: /approve\s+(?:creating|writing)[\s:]+(.+?)\s*\[/i,
    action: 'create_file',
    target_kind: 'path',
    pattern_id: 'text_approve_create',
  },
  {
    regex: /approve\s+(?:editing|modifying)[\s:]+(.+?)\s*\[/i,
    action: 'modify_file',
    target_kind: 'path',
    pattern_id: 'text_approve_edit',
  },
  {
    regex: /approve\s+(?:running|executing)[\s:]+(.+?)\s*\[/i,
    action: 'run_command',
    target_kind: 'command',
    pattern_id: 'text_approve_run',
  },
  // Write to file pattern
  {
    regex: /write(?:s)?\s+to\s+(.+?)\s*\?/i,
    action: 'modify_file',
    target_kind: 'path',
    pattern_id: 'text_write_to',
  },
]

// ─── JSON event parsing ───────────────────────────────────────────────────────

interface ApprovalEvent {
  type?: string
  action?: string
  path?: string
  command?: string
  tool?: string
  input?: { command?: string; path?: string; [key: string]: unknown }
}

function tryParseJsonApproval(text: string): PermissionRequest | null {
  // Try to parse line as JSON event
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return null

  let obj: ApprovalEvent
  try {
    obj = JSON.parse(trimmed) as ApprovalEvent
  } catch {
    return null
  }

  // Check for approval_request type
  if (
    obj.type !== 'approval_request' &&
    obj.type !== 'tool_approval' &&
    obj.type !== 'approval'
  ) {
    return null
  }

  // Extract action and target from known event shapes
  const action = obj.action ?? obj.tool ?? ''
  let permAction: PermissionAction = 'unknown'
  let targetKind: 'path' | 'command' | 'unknown' = 'unknown'
  let target = ''

  if (action.includes('shell') || action.includes('exec') || action.includes('command')) {
    permAction = 'run_command'
    targetKind = 'command'
    target =
      (obj.input?.command ?? obj.command ?? '').toString()
  } else if (action.includes('create') || action.includes('write')) {
    permAction = 'create_file'
    targetKind = 'path'
    target = (obj.input?.path ?? obj.path ?? '').toString()
  } else if (action.includes('edit') || action.includes('modify') || action.includes('patch')) {
    permAction = 'modify_file'
    targetKind = 'path'
    target = (obj.input?.path ?? obj.path ?? '').toString()
  } else if (action.includes('delete') || action.includes('remove')) {
    permAction = 'delete_file'
    targetKind = 'path'
    target = (obj.input?.path ?? obj.path ?? '').toString()
  }

  if (!target) return null

  return {
    raw: text,
    action: permAction,
    target,
    target_kind: targetKind,
    normalized_target: '', // filled in by classify()
    fingerprint: '', // filled in by classify()
  }
}

// ─── Main classifier ──────────────────────────────────────────────────────────

export function classify(
  text: string,
  workingDir: string
): PermissionRequest | null {
  // 1. Try JSON parsing first
  const jsonResult = tryParseJsonApproval(text)
  if (jsonResult) {
    const normalized = normalizeRequest(jsonResult, workingDir)
    const fp = makeFingerprint(jsonResult.action, normalized)
    logger.debug(`classifier: json approval for ${jsonResult.action} on ${normalized}`)
    return { ...jsonResult, normalized_target: normalized, fingerprint: fp }
  }

  // 2. Fall back to text pattern matching
  for (const def of PATTERNS) {
    const m = def.regex.exec(text)
    if (m) {
      const target = (m[1] ?? '').trim()
      if (!target) continue

      const partial: Omit<PermissionRequest, 'normalized_target' | 'fingerprint'> = {
        raw: text,
        action: def.action,
        target,
        target_kind: def.target_kind,
      }

      const normalized = normalizeRequest(partial, workingDir)
      const fp = makeFingerprint(def.action, normalized)
      logger.debug(
        `classifier: pattern ${def.pattern_id} matched ${def.action} on ${normalized}`
      )
      return { ...partial, normalized_target: normalized, fingerprint: fp }
    }
  }

  return null
}
