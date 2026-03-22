import * as crypto from 'crypto'
import { z } from 'zod'
import { sessionManager } from '../state/session-manager.js'
import { sessionRuntimes } from './start-session.js'
import { classify } from '../core/request-classifier.js'
import { securityGuard } from '../middleware/security-guard.js'
import { distill } from '../core/reasoning-distiller.js'
import { safeWrite } from '../utils/safe-write.js'
import {
  appendDecisionLog,
  getSessionDir,
} from '../state/session-manager.js'
import { logger } from '../utils/logger.js'
import type { StreamEvent, SummaryPackage, SecurityVerdictResult } from '../core/types.js'
import { SessionNotFoundError } from '../core/types.js'
import { WAITING_CONFIDENCE_THRESHOLD } from '../config.js'

export const StreamUntilPermissionInputSchema = z.object({
  session_id: z.string(),
  max_summary_tokens: z.number().positive().optional(),
})

export type StreamUntilPermissionInput = z.infer<
  typeof StreamUntilPermissionInputSchema
>

export type StreamUntilPermissionResult =
  | { auto_approved: true; fingerprint: string; cycle_id: string; reason: string }
  | {
      needs_claude: true
      summary_package: SummaryPackage
      security_verdict: SecurityVerdictResult
      alert_reason?: string
    }
  | { completed: true; summary: string; exit_code: number }
  | { error: true; exit_code: number; stderr_tail: string }

async function nextEvent(session_id: string): Promise<StreamEvent> {
  const rt = sessionRuntimes.get(session_id)
  if (!rt) throw new SessionNotFoundError(session_id)

  // Check if there's already a pending event
  const pending = rt.pendingEvents.shift()
  if (pending) return pending

  // Wait for next event
  return new Promise((resolve) => {
    ;(rt as unknown as Record<string, unknown>)['resolveNextEvent'] = resolve
  })
}

export async function toolStreamUntilPermission(
  input: StreamUntilPermissionInput
): Promise<StreamUntilPermissionResult> {
  const { session_id, max_summary_tokens } = input

  const rt = sessionRuntimes.get(session_id)
  if (!rt) throw new SessionNotFoundError(session_id)

  const state = sessionManager.getSession(session_id)
  const sessionDir = getSessionDir(session_id)

  // Event loop — async event-driven, NOT blocking
  while (true) {
    const event = await nextEvent(session_id)

    logger.debug(`[${session_id}] event: ${event.type}`)

    if (event.type === 'permission_candidate') {
      // Classify the candidate
      const request = classify(event.text, state.working_dir)
      if (!request) {
        // classifier returned null — not a real permission request, continue
        continue
      }

      // Create cycle
      const cycle_id = crypto.randomUUID()
      const rawChunkPath = await rt.buffer.saveToCycle(cycle_id, sessionDir)

      // Security Guard evaluation
      // AFTER evaluate() — record timestamp for rate limiting
      const verdict = securityGuard.evaluate(request, rt.cache, state)
      state.recent_request_timestamps.push(new Date().toISOString())

      // Clean up old timestamps (sliding window)
      const windowStart = new Date(Date.now() - 30 * 1000).toISOString()
      state.recent_request_timestamps = state.recent_request_timestamps.filter(
        (ts) => ts >= windowStart
      )

      // Update session state
      state.pending_request = request
      state.pending_cycle_id = cycle_id
      state.runtime_state = 'awaiting_permission'
      await sessionManager.updateSession(state)

      if (verdict.verdict === 'AUTO_APPROVE') {
        // Auto-approve: write 'y' to stdin
        try {
          await safeWrite(rt.handle.stdin as NodeJS.WritableStream & import('stream').Writable, 'y\n')
        } catch (err) {
          logger.error(`safeWrite failed for AUTO_APPROVE: ${err}`)
        }

        // Log decision
        await appendDecisionLog(sessionDir, {
          timestamp: new Date().toISOString(),
          cycle_id,
          request,
          verdict: verdict.verdict,
          response: 'y',
          rationale: `auto-approved by cache rule: ${verdict.reason}`,
        })

        rt.buffer.clear()
        state.runtime_state = 'active'
        state.pending_request = undefined
        state.pending_cycle_id = undefined
        await sessionManager.updateSession(state)

        return {
          auto_approved: true,
          fingerprint: request.fingerprint,
          cycle_id,
          reason: verdict.reason,
        }
      }

      // NEEDS_CLAUDE or BLOCK_AND_ALERT
      const summary = distill(rt.buffer, request, verdict, state, {
        maxSummaryTokens: max_summary_tokens,
        cycleId: cycle_id,
        rawChunkPath,
      })

      return {
        needs_claude: true,
        summary_package: summary,
        security_verdict: verdict,
        alert_reason:
          verdict.verdict === 'BLOCK_AND_ALERT' ? verdict.reason : undefined,
      }
    }

    if (event.type === 'task_complete') {
      state.runtime_state = 'completed'
      state.status = 'completed'
      await sessionManager.updateSession(state)
      return {
        completed: true,
        summary: event.summary,
        exit_code: event.exit_code,
      }
    }

    if (event.type === 'process_exit') {
      const code = event.code ?? -1
      if (code !== 0) {
        state.runtime_state = 'error'
        state.status = 'error'
        await sessionManager.updateSession(state)
        const recentLines = rt.buffer
          .getAll()
          .slice(-20)
          .map((e) => e.text)
          .join('\n')
        return {
          error: true,
          exit_code: code,
          stderr_tail: recentLines,
        }
      }
      // code === 0 — task_complete should have been emitted, but handle here too
      state.runtime_state = 'completed'
      state.status = 'completed'
      await sessionManager.updateSession(state)
      return {
        completed: true,
        summary: 'Process exited with code 0',
        exit_code: 0,
      }
    }

    if (event.type === 'error') {
      state.runtime_state = 'error'
      state.status = 'error'
      await sessionManager.updateSession(state)
      return {
        error: true,
        exit_code: -1,
        stderr_tail: event.message,
      }
    }

    if (event.type === 'waiting_for_input') {
      // Fallback: process is waiting without a recognized permission pattern
      if (
        event.heuristic.combined_confidence >= WAITING_CONFIDENCE_THRESHOLD
      ) {
        const lastLines = event.heuristic.recent_tail
        return {
          needs_claude: true,
          summary_package: {
            recent_actions: lastLines,
            files_mentioned: [],
            files_touched: [],
            errors_seen: [],
            reasoning_chunk: lastLines.join('\n'),
            reasoning_chunk_truncated: false,
            permission_request: {
              raw: lastLines[lastLines.length - 1] ?? '',
              action: 'unknown',
              target: '',
              target_kind: 'unknown',
              normalized_target: '',
              fingerprint: '',
            },
            security_verdict: {
              verdict: 'NEEDS_CLAUDE',
              reason: 'unexpected_wait — process is waiting for input',
            },
            session_context: {
              task: state.task,
              plan: state.plan,
              completed_steps: state.completed_steps,
            },
            raw_chunk_available: true,
            cycle_id: crypto.randomUUID(),
          },
          security_verdict: {
            verdict: 'NEEDS_CLAUDE',
            reason: 'unexpected_wait',
          },
          alert_reason: undefined,
        }
      }
    }

    // 'line' events — just continue accumulating
  }
}
