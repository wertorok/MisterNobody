import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import https from 'https'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')

// Load env without polluting process.env
const { readEnvFile } = await import(path.join(PROJECT_ROOT, 'src', 'env.js'))
const env = readEnvFile()

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'

const ok = (label: string, val?: string) =>
  console.log(`${GREEN}✓${RESET} ${label}${val ? ': ' + val : ''}`)
const fail = (label: string, hint?: string) =>
  console.log(`${RED}✗${RESET} ${label}${hint ? ' — ' + hint : ''}`)
const warn = (label: string, hint?: string) =>
  console.log(`${YELLOW}⚠${RESET} ${label}${hint ? ' — ' + hint : ''}`)

function checkGet(url: string): Promise<boolean> {
  return new Promise(resolve => {
    https.get(url, res => resolve(res.statusCode === 200)).on('error', () => resolve(false))
  })
}

console.log(`\n${BOLD}ClaudeClaw Status${RESET}\n`)

// Node version
const nodeMajor = parseInt(process.version.slice(1).split('.')[0], 10)
nodeMajor >= 20
  ? ok('Node.js', process.version)
  : fail('Node.js', `${process.version} — requires 20+`)

// Claude CLI
try {
  const v = execSync('claude --version', { encoding: 'utf-8' }).trim()
  ok('Claude CLI', v)
} catch {
  fail('Claude CLI', 'not found or not logged in')
}

// Telegram token
if (env['TELEGRAM_BOT_TOKEN']) {
  const valid = await checkGet(
    `https://api.telegram.org/bot${env['TELEGRAM_BOT_TOKEN']}/getMe`
  )
  valid ? ok('Telegram token') : fail('Telegram token', 'invalid')
} else {
  fail('Telegram token', 'not set')
}

// Chat ID
env['ALLOWED_CHAT_ID']
  ? ok('Chat ID', env['ALLOWED_CHAT_ID'])
  : warn('Chat ID', 'not set — bot is in open access mode')

// Groq STT
env['GROQ_API_KEY'] ? ok('Groq API key') : warn('Groq API key', 'not set — voice STT disabled')

// ElevenLabs TTS
env['ELEVENLABS_API_KEY'] && env['ELEVENLABS_VOICE_ID']
  ? ok('ElevenLabs TTS')
  : warn('ElevenLabs TTS', 'not configured — voice replies disabled')

// Google API
env['GOOGLE_API_KEY'] ? ok('Google API key') : warn('Google API key', 'not set — video analysis disabled')

// systemd service (Linux)
try {
  const status = execSync('systemctl --user is-active claudeclaw 2>/dev/null', { encoding: 'utf-8' }).trim()
  status === 'active'
    ? ok('systemd service', 'active')
    : warn('systemd service', status)
} catch {
  warn('systemd service', 'not installed')
}

// Database
const dbPath = path.join(PROJECT_ROOT, 'store', 'claudeclaw.db')
if (existsSync(dbPath)) {
  try {
    const { default: Database } = await import('better-sqlite3')
    const db = new Database(dbPath, { readonly: true })
    const memCount = (db.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number }).c
    const taskCount = (db.prepare('SELECT COUNT(*) as c FROM scheduled_tasks WHERE status="active"').get() as { c: number }).c
    ok('Database', `${memCount} memories, ${taskCount} active tasks`)
    db.close()
  } catch {
    warn('Database', 'exists but could not read')
  }
} else {
  warn('Database', 'not found — run npm run start to initialize')
}

console.log()
