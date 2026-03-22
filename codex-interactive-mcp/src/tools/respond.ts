import { z } from 'zod'
import { sessionManager, appendDecisionLog, getSessionDir } from '../state/session-manager.js'
import { sessionRuntimes } from './start-session.js'
import { validatePattern } from '../middleware/permission-cache.js'
import { safeWrite } from '../utils/safe-write.js'
import { SessionMutex } from '../utils/mutex.js'
import { logger } from '../utils/logger.js'
import type { CacheRule } from '../core/types.js'
import {
  SessionNotFoundError,
  IdempotencyError,
} from '../core/types.js'
import { CLI_MODE } from '../config.js'

export const RespondInputSchema = z.object({
  session_id: z.string(),
  response: z.enum(['y', 'n']),
  instruction: z.string().optional(),
  cache_rule: z
    .object({
      pattern: z.string(),
      matcher_type: z.enum(['glob', 'exact']),
      scope: z.enum(['session', 'task']),
      // action is NOT accepted from input — inherited from pending_request
    })
    .optional(),
  rationale: z.string().optional(),
})

export type RespondInput = z.infer<typeof RespondInputSchema>

const mutex = new SessionMutex()

// Global idempotency guard: cycle_id → applied
const appliedCycles = new Set<string>()

export async function toolRespond(input: RespondInput): Promise<{
  success: boolean
  cycle_id: string
  cache_rule_added?: CacheRule
}> {
  const { session_id, response, instruction, cache_rule, rationale } = input

  // Validate: instruction required when response = 'n'
  if (response === 'n' && !instruction) {
    throw new Error(
      "instruction is required when response is 'n'. Tell Codex what to do instead."
    )
  }

  return mutex.acquire(session_id, async () => {
    const rt = sessionRuntimes.get(session_id)
    if (!rt) throw new SessionNotFoundError(session_id)

    const state = sessionManager.getSession(session_id)

    // Idempotency guard
    const cycle_id = state.pending_cycle_id
    if (!cycle_id) {
      throw new Error(`No pending cycle for session ${session_id}`)
    }

    if (appliedCycles.has(cycle_id)) {
      throw new IdempotencyError(cycle_id)
    }

    const pendingRequest = state.pending_request
    if (!pendingRequest) {
      throw new Error(`No pending request for session ${session_id}`)
    }

    // Mark as applied BEFORE writing to stdin (idempotency)
    appliedCycles.add(cycle_id)

    const sessionDir = getSessionDir(session_id)

    // Write response to Codex stdin
    const stdinStream = rt.handle.stdin as NodeJS.WritableStream & import('stream').Writable

    if (CLI_MODE === 'pipe') {
      await safeWrite(stdinStream, `${response}\n`)
      if (response === 'n' && instruction) {
        // Small delay before sending instruction
        await new Promise((r) => setTimeout(r, 75))
        await safeWrite(stdinStream, `${instruction}\n`)
      }
    } else {
      // PTY mode: no \n
      await safeWrite(stdinStream, response)
      if (response === 'n' && instruction) {
        await new Promise((r) => setTimeout(r, 75))
        await safeWrite(stdinStream, `${instruction}\r`)
      }
    }

    // Add cache rule if requested
    let addedRule: CacheRule | undefined
    if (cache_rule && response === 'y') {
      try {
        validatePattern(cache_rule.pattern, pendingRequest.action)
        addedRule = rt.cache.addRule(
          {
            action: pendingRequest.action, // ALWAYS from pending_request
            matcher_type: cache_rule.matcher_type,
            pattern: cache_rule.pattern,
            scope: cache_rule.scope,
            task_lineage_id: state.task_lineage_id,
            approved_by: 'claude',
          },
          pendingRequest
        )

        // Add to session state for persistence
        state.approved_patterns.push(addedRule)
      } catch (err) {
        logger.warn(`Cache rule validation failed: ${err}`)
      }
    }

    // Log decision
    await appendDecisionLog(sessionDir, {
      timestamp: new Date().toISOString(),
      cycle_id,
      request: pendingRequest,
      verdict: response === 'y' ? 'NEEDS_CLAUDE' : 'BLOCK_AND_ALERT',
      response,
      rationale: rationale ?? (response === 'y' ? 'approved by Claude' : 'rejected by Claude'),
      cache_rule_added: addedRule,
    })

    // Clear buffer and update state
    rt.buffer.clear()
    state.runtime_state = 'active'
    state.pending_request = undefined
    state.pending_cycle_id = undefined
    await sessionManager.updateSession(state)

    logger.info(
      `codex_respond: cycle ${cycle_id} → ${response}, rule: ${addedRule?.pattern ?? 'none'}`
    )

    return {
      success: true,
      cycle_id,
      cache_rule_added: addedRule,
    }
  })
}
