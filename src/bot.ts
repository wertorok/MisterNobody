import { Bot, InputFile, type Context } from 'grammy'
import {
  TELEGRAM_BOT_TOKEN,
  ALLOWED_CHAT_ID,
  MAX_MESSAGE_LENGTH,
} from './config.js'
import { getSession, setSession, clearSession, getAllMemories } from './db.js'
import { runAgent } from './agent.js'
import { buildMemoryContext, saveConversationTurn } from './memory.js'
import { transcribeAudio, synthesizeSpeech, voiceCapabilities } from './voice.js'
import {
  downloadMedia,
  buildPhotoMessage,
  buildDocumentMessage,
  buildVideoMessage,
} from './media.js'
import { logger } from './logger.js'

// Voice mode: set of chat IDs with voice replies enabled
const voiceModeChats = new Set<string>()

export function formatForTelegram(text: string): string {
  // Step 1: extract and protect code blocks
  const codeBlocks: string[] = []
  let result = text.replace(/```[\s\S]*?```/g, (match) => {
    const idx = codeBlocks.length
    // Extract language hint and content
    const inner = match.slice(3, -3)
    const nl = inner.indexOf('\n')
    const content = nl === -1 ? inner : inner.slice(nl + 1)
    const escaped = escapeHtml(content)
    codeBlocks.push(`<pre><code>${escaped}</code></pre>`)
    return `\x00CODE${idx}\x00`
  })

  // Step 2: inline code
  const inlineCodes: string[] = []
  result = result.replace(/`([^`]+)`/g, (_, inner) => {
    const idx = inlineCodes.length
    inlineCodes.push(`<code>${escapeHtml(inner)}</code>`)
    return `\x00INLINE${idx}\x00`
  })

  // Step 3: escape HTML in plain text portions
  result = result.replace(/(?!\x00)[^<\x00]+/g, (match) => escapeHtml(match))

  // Step 4: headings
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')

  // Step 5: bold
  result = result.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  result = result.replace(/__(.+?)__/g, '<b>$1</b>')

  // Step 6: italic
  result = result.replace(/\*(.+?)\*/g, '<i>$1</i>')
  result = result.replace(/_(.+?)_/g, '<i>$1</i>')

  // Step 7: strikethrough
  result = result.replace(/~~(.+?)~~/g, '<s>$1</s>')

  // Step 8: links
  result = result.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')

  // Step 9: checkboxes
  result = result.replace(/- \[ \]/g, '☐')
  result = result.replace(/- \[x\]/gi, '☑')

  // Step 10: strip separators
  result = result.replace(/^---+$/gm, '')
  result = result.replace(/^\*\*\*+$/gm, '')

  // Step 11: restore code blocks
  result = result.replace(/\x00CODE(\d+)\x00/g, (_, i) => codeBlocks[Number(i)])
  result = result.replace(/\x00INLINE(\d+)\x00/g, (_, i) => inlineCodes[Number(i)])

  return result.trim()
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function splitMessage(text: string, limit = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= limit) return [text]
  const parts: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      parts.push(remaining)
      break
    }
    let splitAt = remaining.lastIndexOf('\n', limit)
    if (splitAt <= 0) splitAt = limit
    parts.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt).trimStart()
  }
  return parts
}

export function isAuthorised(chatId: number | string): boolean {
  if (!ALLOWED_CHAT_ID) return true // first-run mode
  return String(chatId) === String(ALLOWED_CHAT_ID)
}

export function createBot(): Bot {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN is not set in .env')
  }
  const bot = new Bot(TELEGRAM_BOT_TOKEN)

  async function sendText(ctx: Context, text: string): Promise<void> {
    const parts = splitMessage(formatForTelegram(text))
    for (const part of parts) {
      await ctx.reply(part, { parse_mode: 'HTML' })
    }
  }

  async function handleMessage(
    ctx: Context,
    rawText: string,
    forceVoiceReply = false
  ): Promise<void> {
    const chatId = String(ctx.chat?.id)
    if (!isAuthorised(ctx.chat?.id ?? 0)) {
      await ctx.reply('Unauthorized.')
      return
    }

    const caps = voiceCapabilities()

    // Build memory context
    const memCtx = await buildMemoryContext(chatId, rawText)
    const fullMessage = memCtx ? `${memCtx}\n\n${rawText}` : rawText

    // Typing indicator
    const typing = async () => {
      try { await ctx.replyWithChatAction('typing') } catch {}
    }
    await typing()

    const sessionId = getSession(chatId)
    const { text, newSessionId } = await runAgent(fullMessage, sessionId, typing)

    if (newSessionId) setSession(chatId, newSessionId)

    const response = text ?? '(no response)'

    await saveConversationTurn(chatId, rawText, response)

    const useVoice = caps.tts && (forceVoiceReply || voiceModeChats.has(chatId))

    if (useVoice) {
      try {
        await ctx.replyWithChatAction('record_voice')
        const audio = await synthesizeSpeech(response)
        await ctx.replyWithVoice(new InputFile(audio, 'reply.mp3'))
        return
      } catch (err) {
        logger.warn({ err }, 'TTS failed, falling back to text')
      }
    }

    await sendText(ctx, response)
  }

  // Commands
  bot.command('start', async (ctx) => {
    await ctx.reply(
      'ClaudeClaw online. Send me a message.\n\n' +
      'Commands: /newchat /chatid /memory /voice /wa /schedule /help'
    )
  })

  bot.command('help', async (ctx) => {
    await ctx.reply(
      '/newchat — start fresh session\n' +
      '/chatid — show your chat ID\n' +
      '/memory — show stored memories\n' +
      '/voice — toggle voice replies\n' +
      '/wa — WhatsApp bridge\n' +
      '/schedule — manage scheduled tasks'
    )
  })

  bot.command('chatid', async (ctx) => {
    await ctx.reply(`Your chat ID: ${ctx.chat?.id}`)
  })

  bot.command('newchat', async (ctx) => {
    const chatId = String(ctx.chat?.id)
    clearSession(chatId)
    await ctx.reply('Session cleared. Starting fresh.')
  })

  bot.command('forget', async (ctx) => {
    const chatId = String(ctx.chat?.id)
    clearSession(chatId)
    await ctx.reply('Session cleared.')
  })

  bot.command('memory', async (ctx) => {
    const chatId = String(ctx.chat?.id)
    const memories = getAllMemories(chatId)
    if (memories.length === 0) {
      await ctx.reply('No memories stored yet.')
      return
    }
    const lines = memories
      .slice(0, 20)
      .map(m => `[${m.sector}] ${m.content.slice(0, 80)}`)
      .join('\n')
    await ctx.reply(`Stored memories:\n\n${lines}`)
  })

  bot.command('voice', async (ctx) => {
    const chatId = String(ctx.chat?.id)
    const caps = voiceCapabilities()
    if (!caps.tts) {
      await ctx.reply('TTS not configured. Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env')
      return
    }
    if (voiceModeChats.has(chatId)) {
      voiceModeChats.delete(chatId)
      await ctx.reply('Voice replies OFF. Bot will respond with text.')
    } else {
      voiceModeChats.add(chatId)
      await ctx.reply('Voice replies ON. Bot will respond with audio.')
    }
  })

  // WhatsApp bridge
  bot.command('wa', async (ctx) => {
    await handleMessage(ctx, '/wa list recent WhatsApp chats and show them')
  })

  // Scheduler commands
  bot.command('schedule', async (ctx) => {
    const text = ctx.message?.text ?? ''
    const args = text.slice('/schedule'.length).trim()
    if (!args) {
      await ctx.reply(
        'Schedule commands:\n' +
        '/schedule list\n' +
        '/schedule create "prompt" "0 9 * * *"\n' +
        '/schedule pause <id>\n' +
        '/schedule resume <id>\n' +
        '/schedule delete <id>'
      )
      return
    }
    await handleMessage(ctx, `Manage scheduled tasks: ${args}`)
  })

  // Text messages
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text
    if (text.startsWith('/')) return // handled by commands
    await handleMessage(ctx, text)
  })

  // Voice notes
  bot.on('message:voice', async (ctx) => {
    if (!isAuthorised(ctx.chat?.id ?? 0)) return
    const caps = voiceCapabilities()
    if (!caps.stt) {
      await ctx.reply('Voice transcription not configured. Set GROQ_API_KEY in .env')
      return
    }
    try {
      await ctx.replyWithChatAction('typing')
      const fileId = ctx.message.voice.file_id
      const localPath = await downloadMedia(fileId, 'voice.oga')
      const transcript = await transcribeAudio(localPath)
      logger.info({ transcript: transcript.slice(0, 80) }, 'Voice transcribed')
      await handleMessage(ctx, `[Voice transcribed]: ${transcript}`, true)
    } catch (err) {
      logger.error({ err }, 'Voice handler error')
      await ctx.reply(`Voice error: ${String(err)}`)
    }
  })

  // Photos
  bot.on('message:photo', async (ctx) => {
    if (!isAuthorised(ctx.chat?.id ?? 0)) return
    try {
      await ctx.replyWithChatAction('typing')
      const photo = ctx.message.photo.at(-1)! // largest size
      const caption = ctx.message.caption
      const localPath = await downloadMedia(photo.file_id, 'photo.jpg')
      await handleMessage(ctx, buildPhotoMessage(localPath, caption))
    } catch (err) {
      logger.error({ err }, 'Photo handler error')
      await ctx.reply(`Photo error: ${String(err)}`)
    }
  })

  // Documents
  bot.on('message:document', async (ctx) => {
    if (!isAuthorised(ctx.chat?.id ?? 0)) return
    try {
      await ctx.replyWithChatAction('typing')
      const doc = ctx.message.document
      const caption = ctx.message.caption
      const localPath = await downloadMedia(doc.file_id, doc.file_name ?? 'document')
      await handleMessage(ctx, buildDocumentMessage(localPath, doc.file_name ?? 'document', caption))
    } catch (err) {
      logger.error({ err }, 'Document handler error')
      await ctx.reply(`Document error: ${String(err)}`)
    }
  })

  // Video
  bot.on('message:video', async (ctx) => {
    if (!isAuthorised(ctx.chat?.id ?? 0)) return
    try {
      await ctx.replyWithChatAction('typing')
      const video = ctx.message.video
      const caption = ctx.message.caption
      const localPath = await downloadMedia(video.file_id, 'video.mp4')
      await handleMessage(ctx, buildVideoMessage(localPath, caption))
    } catch (err) {
      logger.error({ err }, 'Video handler error')
      await ctx.reply(`Video error: ${String(err)}`)
    }
  })

  bot.catch((err) => {
    logger.error({ err: err.error, ctx: err.ctx.update }, 'Bot error')
  })

  return bot
}

export type TelegramSender = (chatId: string, text: string) => Promise<void>

export function createSender(bot: Bot): TelegramSender {
  return async (chatId: string, text: string) => {
    const parts = splitMessage(formatForTelegram(text))
    for (const part of parts) {
      await bot.api.sendMessage(chatId, part, { parse_mode: 'HTML' })
    }
  }
}
