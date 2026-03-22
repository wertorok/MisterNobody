import { z } from 'zod'
import { sessionManager } from '../state/session-manager.js'
import { getSessionDir } from '../state/session-manager.js'
import * as path from 'path'
import type { SessionState } from '../core/types.js'

export const GetStateInputSchema = z.object({
  session_id: z.string().optional(),
})

export type GetStateInput = z.infer<typeof GetStateInputSchema>

export async function toolGetState(input: GetStateInput): Promise<{
  session: SessionState
  decisions_log_path: string
}> {
  let state: SessionState | null = null

  if (input.session_id) {
    state = sessionManager.getSession(input.session_id)
  } else {
    state = sessionManager.getLatestSession()
    if (!state) {
      throw new Error('No active sessions found')
    }
  }

  const sessionDir = getSessionDir(state.session_id)
  const decisionsLogPath = path.join(sessionDir, 'decisions.log')

  return {
    session: state,
    decisions_log_path: decisionsLogPath,
  }
}
