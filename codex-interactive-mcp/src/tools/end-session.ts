import { z } from 'zod'
import { sessionManager } from '../state/session-manager.js'
import { sessionRuntimes } from './start-session.js'
import { killProcessTree } from '../core/codex-process.js'
import { logger } from '../utils/logger.js'
import { SessionNotFoundError } from '../core/types.js'

export const EndSessionInputSchema = z.object({
  session_id: z.string(),
  status: z.enum(['completed', 'cancelled']),
})

export type EndSessionInput = z.infer<typeof EndSessionInputSchema>

export async function toolEndSession(input: EndSessionInput): Promise<{
  success: boolean
  session_id: string
}> {
  const { session_id, status } = input

  const rt = sessionRuntimes.get(session_id)
  if (!rt) {
    // Session might already be ended
    logger.warn(`codex_end_session: no runtime for session ${session_id}`)
    // Try to mark as completed in persistent state anyway
    await sessionManager.endSession(
      session_id,
      status === 'completed' ? 'completed' : 'interrupted'
    )
    return { success: true, session_id }
  }

  const state = sessionManager.getSessionOrNull(session_id)
  if (!state) throw new SessionNotFoundError(session_id)

  // 1. Kill the entire process tree (SIGTERM → 5s → SIGKILL)
  if (state.process_pid) {
    await killProcessTree(state.process_pid)
  }

  // 2. Clean up parser
  rt.parser.destroy()

  // 3. Remove from runtime registry
  sessionRuntimes.delete(session_id)

  // 4. End session (generates previous_summary, saves task-scope rules)
  await sessionManager.endSession(
    session_id,
    status === 'completed' ? 'completed' : 'interrupted'
  )

  logger.info(`Session ${session_id} ended: ${status}`)

  return { success: true, session_id }
}
