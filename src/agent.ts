import { query } from '@anthropic-ai/claude-agent-sdk'
import { PROJECT_ROOT, TYPING_REFRESH_MS } from './config.js'
import { logger } from './logger.js'

export async function runAgent(
  message: string,
  sessionId?: string,
  onTyping?: () => void
): Promise<{ text: string | null; newSessionId?: string }> {
  logger.info({ sessionId: sessionId?.slice(0, 8) }, 'Running agent')

  let typingInterval: ReturnType<typeof setInterval> | undefined
  if (onTyping) {
    typingInterval = setInterval(onTyping, TYPING_REFRESH_MS)
  }

  try {
    let responseText: string | null = null
    let newSessionId: string | undefined

    const result = query({
      prompt: message,
      options: {
        cwd: PROJECT_ROOT,
        permissionMode: 'bypassPermissions',
        settingSources: ['project', 'user'],
        ...(sessionId ? { resume: sessionId } : {}),
      },
    })

    for await (const event of result) {
      const e = event as Record<string, unknown>
      if (e['type'] === 'system' && e['subtype'] === 'init') {
        newSessionId = e['session_id'] as string | undefined
        logger.debug({ newSessionId: newSessionId?.slice(0, 8) }, 'Session init')
      } else if (e['type'] === 'result') {
        responseText = (e['result'] as string) ?? null
      }
    }

    return { text: responseText, newSessionId }
  } finally {
    if (typingInterval) clearInterval(typingInterval)
  }
}
