import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import path from 'path'
import { TELEGRAM_BOT_TOKEN, STORE_DIR, PROJECT_ROOT } from './config.js'
import { initDatabase } from './db.js'
import { runDecaySweep } from './memory.js'
import { cleanupOldUploads } from './media.js'
import { createBot, createSender } from './bot.js'
import { initScheduler, stopScheduler } from './scheduler.js'
import { initWhatsApp } from './whatsapp.js'
import { logger } from './logger.js'

const PID_FILE = path.join(STORE_DIR, 'claudeclaw.pid')
const BANNER = `
 ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗
██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝
██║     ██║     ███████║██║   ██║██║  ██║█████╗
██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝
╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗
 ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝╚══════╝
`

function acquireLock(): void {
  mkdirSync(STORE_DIR, { recursive: true })

  if (existsSync(PID_FILE)) {
    const oldPid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10)
    if (!isNaN(oldPid)) {
      try {
        process.kill(oldPid, 0) // check if alive
        logger.info({ oldPid }, 'Killing stale process')
        process.kill(oldPid, 'SIGTERM')
      } catch {
        // process doesn't exist, stale pid file
      }
    }
  }

  writeFileSync(PID_FILE, String(process.pid))
  logger.debug({ pid: process.pid }, 'Lock acquired')
}

function releaseLock(): void {
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE)
  } catch {}
}

async function main(): Promise<void> {
  console.log(BANNER)
  logger.info({ cwd: PROJECT_ROOT }, 'ClaudeClaw starting')

  if (!TELEGRAM_BOT_TOKEN) {
    logger.error('TELEGRAM_BOT_TOKEN is not set. Run npm run setup or create a .env file.')
    process.exit(1)
  }

  acquireLock()
  mkdirSync(path.join(PROJECT_ROOT, 'workspace', 'uploads'), { recursive: true })

  initDatabase()

  // Memory decay sweep — daily
  runDecaySweep()
  setInterval(runDecaySweep, 24 * 60 * 60 * 1000)

  // Clean up old uploads
  cleanupOldUploads()

  const bot = createBot()
  const send = createSender(bot)

  // Scheduler
  initScheduler(send)

  // WhatsApp bridge
  initWhatsApp(async (chatJid, from, body) => {
    // Notify via bot to allowed chat
    const { ALLOWED_CHAT_ID } = await import('./config.js')
    if (ALLOWED_CHAT_ID) {
      await send(
        ALLOWED_CHAT_ID,
        `📱 <b>WhatsApp</b> from <code>${from}</code>:\n${body}`
      )
    }
  })

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down')
    stopScheduler()
    releaseLock()
    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'Uncaught exception')
  })
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled rejection')
  })

  logger.info('Starting Telegram bot...')
  try {
    await bot.start({
      onStart: (info) => {
        logger.info({ username: info.username }, 'ClaudeClaw running')
        console.log(`\n✓ Bot @${info.username} is online\n`)
      },
    })
  } catch (err) {
    logger.error({ err }, 'Bot failed to start. Check TELEGRAM_BOT_TOKEN.')
    releaseLock()
    process.exit(1)
  }
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error')
  process.exit(1)
})
