import wwjs from 'whatsapp-web.js'
const { Client, LocalAuth } = wwjs
type Message = wwjs.Message
import qrcode from 'qrcode-terminal'
import {
  saveWaMessage,
  getPendingWaMessages,
  markWaMessageSent,
} from './db.js'
import { logger } from './logger.js'
import { STORE_DIR } from './config.js'

export type WaIncomingHandler = (chatJid: string, from: string, body: string) => Promise<void>

let client: Client

export function initWhatsApp(onIncoming: WaIncomingHandler): void {
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: STORE_DIR }),
    puppeteer: {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: true,
    },
  })

  client.on('qr', (qr) => {
    logger.info('Scan this QR code with WhatsApp:')
    qrcode.generate(qr, { small: true })
  })

  client.on('ready', () => {
    logger.info('WhatsApp client ready')
    // Start outbox polling
    setInterval(flushOutbox, 3000)
  })

  client.on('message', async (msg: Message) => {
    try {
      const chat = await msg.getChat()
      const chatJid = chat.id._serialized
      const from = msg.from

      saveWaMessage(msg.id._serialized, chatJid, false, msg.body, Math.floor(Date.now() / 1000))
      logger.debug({ chatJid, from }, 'WA message received')

      await onIncoming(chatJid, from, msg.body)
    } catch (err) {
      logger.error({ err }, 'WA message handler error')
    }
  })

  client.on('disconnected', (reason) => {
    logger.warn({ reason }, 'WhatsApp disconnected')
  })

  client.initialize().catch(err => {
    logger.error({ err }, 'WhatsApp init failed')
  })
}

async function flushOutbox(): Promise<void> {
  const pending = getPendingWaMessages()
  for (const msg of pending) {
    try {
      await client.sendMessage(msg.chat_jid, msg.message)
      markWaMessageSent(msg.id)
      logger.debug({ chatJid: msg.chat_jid }, 'WA message sent')
    } catch (err) {
      logger.warn({ err, msgId: msg.id }, 'Failed to send WA message')
    }
  }
}

export async function sendWaMessage(chatJid: string, text: string): Promise<void> {
  if (!client) throw new Error('WhatsApp client not initialized')
  await client.sendMessage(chatJid, text)
  saveWaMessage(
    `out_${Date.now()}`,
    chatJid,
    true,
    text,
    Math.floor(Date.now() / 1000)
  )
}

export async function getWaChats(): Promise<Array<{ id: string; name: string; lastMessage?: string }>> {
  if (!client) return []
  const chats = await client.getChats()
  return chats.slice(0, 20).map(c => ({
    id: c.id._serialized,
    name: c.name || c.id.user,
  }))
}
