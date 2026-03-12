import {
  insertMemory,
  searchMemoriesFTS,
  getRecentMemories,
  touchMemory,
  decayMemories as dbDecayMemories,
} from './db.js'
import { logger } from './logger.js'

const SEMANTIC_PATTERN = /\b(my|i am|i'm|i prefer|remember|always|never)\b/i

function sanitizeFtsQuery(text: string): string {
  // Strip non-alphanumeric, collapse spaces, add wildcard suffix
  return text
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 2)
    .slice(0, 5)
    .map(w => `${w}*`)
    .join(' OR ')
}

export async function buildMemoryContext(chatId: string, userMessage: string): Promise<string> {
  try {
    const ftsQuery = sanitizeFtsQuery(userMessage)
    const ftsResults = ftsQuery
      ? searchMemoriesFTS(chatId, ftsQuery, 3)
      : []

    const recent = getRecentMemories(chatId, 5)

    // Deduplicate by id
    const seen = new Set<number>()
    const combined: Array<{ id: number; content: string; sector: string }> = []
    for (const m of [...ftsResults, ...recent]) {
      if (!seen.has(m.id)) {
        seen.add(m.id)
        combined.push(m)
      }
    }

    if (combined.length === 0) return ''

    // Touch all results
    for (const m of combined) {
      touchMemory(m.id)
    }

    const lines = combined.map(m => `- ${m.content} (${m.sector})`)
    return `[Memory context]\n${lines.join('\n')}`
  } catch (err) {
    logger.warn({ err }, 'Failed to build memory context')
    return ''
  }
}

export async function saveConversationTurn(
  chatId: string,
  userMsg: string,
  assistantMsg: string
): Promise<void> {
  try {
    if (userMsg.length <= 20 || userMsg.startsWith('/')) return

    const isUserSemantic = SEMANTIC_PATTERN.test(userMsg)
    const isAssistantSemantic = SEMANTIC_PATTERN.test(assistantMsg)

    insertMemory(chatId, userMsg, isUserSemantic ? 'semantic' : 'episodic')

    if (assistantMsg && assistantMsg.length > 20) {
      insertMemory(chatId, assistantMsg.slice(0, 500), isAssistantSemantic ? 'semantic' : 'episodic')
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to save conversation turn')
  }
}

export function runDecaySweep(): void {
  try {
    dbDecayMemories()
    logger.debug('Memory decay sweep complete')
  } catch (err) {
    logger.warn({ err }, 'Decay sweep failed')
  }
}
