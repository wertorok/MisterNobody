import { createInterface } from 'readline'
import { execSync, spawnSync } from 'child_process'
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import os from 'os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')

const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

const ok = (msg: string) => console.log(`${GREEN}✓${RESET} ${msg}`)
const warn = (msg: string) => console.log(`${YELLOW}⚠${RESET} ${msg}`)
const fail = (msg: string) => console.log(`${RED}✗${RESET} ${msg}`)
const info = (msg: string) => console.log(`${CYAN}→${RESET} ${msg}`)

const BANNER = `
 ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗
██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝
██║     ██║     ███████║██║   ██║██║  ██║█████╗
██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝
╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗
 ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝╚══════╝
`

const rl = createInterface({ input: process.stdin, output: process.stdout })
const ask = (q: string): Promise<string> =>
  new Promise(resolve => rl.question(`${BOLD}${q}${RESET} `, resolve))

async function main() {
  console.log(BOLD + CYAN + BANNER + RESET)
  console.log(`${BOLD}ClaudeClaw Setup Wizard${RESET}\n`)

  // ── Check requirements ────────────────────────────────────
  console.log(`\n${BOLD}Checking requirements...${RESET}`)

  const nodeVersion = process.version
  const nodeMajor = parseInt(nodeVersion.slice(1).split('.')[0], 10)
  if (nodeMajor >= 20) {
    ok(`Node.js ${nodeVersion}`)
  } else {
    fail(`Node.js ${nodeVersion} — requires 20+. Please upgrade.`)
    process.exit(1)
  }

  try {
    const claudeVersion = execSync('claude --version', { encoding: 'utf-8' }).trim()
    ok(`Claude CLI: ${claudeVersion}`)
  } catch {
    fail('Claude CLI not found. Install it: npm install -g @anthropic-ai/claude-code')
    process.exit(1)
  }

  // ── Build project ─────────────────────────────────────────
  console.log(`\n${BOLD}Building project...${RESET}`)
  info('Running npm install...')
  const installResult = spawnSync('npm', ['install'], { cwd: PROJECT_ROOT, stdio: 'inherit' })
  if (installResult.status !== 0) {
    fail('npm install failed')
    process.exit(1)
  }
  ok('Dependencies installed')

  info('Running npm run build...')
  const buildResult = spawnSync('npm', ['run', 'build'], { cwd: PROJECT_ROOT, stdio: 'inherit' })
  if (buildResult.status !== 0) {
    fail('Build failed. Fix TypeScript errors above and re-run setup.')
    process.exit(1)
  }
  ok('Build successful')

  // ── Open CLAUDE.md for editing ────────────────────────────
  console.log(`\n${BOLD}Personalizing your assistant...${RESET}`)
  info('Opening CLAUDE.md in your editor. Fill in YOUR NAME and assistant name, then save and close.')
  await ask('Press Enter to open CLAUDE.md...')

  const editor = process.env.EDITOR || process.env.VISUAL || 'nano'
  spawnSync(editor, [path.join(PROJECT_ROOT, 'CLAUDE.md')], { stdio: 'inherit' })

  // ── Collect config ────────────────────────────────────────
  console.log(`\n${BOLD}Configuring ClaudeClaw...${RESET}`)
  info('You need a Telegram bot token. Create one via @BotFather on Telegram.')
  info('Start a chat with @BotFather, send /newbot, and follow the instructions.')

  const botToken = await ask('\nTelegram bot token:')
  if (!botToken || !botToken.includes(':')) {
    fail('Invalid bot token. It should look like: 123456789:ABC...')
    process.exit(1)
  }

  // Voice
  console.log(`\n${BOLD}Voice configuration (optional)${RESET}`)
  const groqKey = await ask('Groq API key (for voice transcription, press Enter to skip):')
  const elevenKey = await ask('ElevenLabs API key (for voice replies, press Enter to skip):')
  let elevenVoiceId = ''
  if (elevenKey) {
    elevenVoiceId = await ask('ElevenLabs voice ID:')
  }

  // Video
  console.log(`\n${BOLD}Video analysis (optional)${RESET}`)
  const googleKey = await ask('Google API key for Gemini (press Enter to skip):')

  // ── Write .env ────────────────────────────────────────────
  console.log(`\n${BOLD}Writing .env...${RESET}`)

  const envLines = [
    `TELEGRAM_BOT_TOKEN=${botToken}`,
    `ALLOWED_CHAT_ID=`,
    groqKey ? `GROQ_API_KEY=${groqKey}` : '# GROQ_API_KEY=',
    elevenKey ? `ELEVENLABS_API_KEY=${elevenKey}` : '# ELEVENLABS_API_KEY=',
    elevenVoiceId ? `ELEVENLABS_VOICE_ID=${elevenVoiceId}` : '# ELEVENLABS_VOICE_ID=',
    googleKey ? `GOOGLE_API_KEY=${googleKey}` : '# GOOGLE_API_KEY=',
  ]

  writeFileSync(path.join(PROJECT_ROOT, '.env'), envLines.join('\n') + '\n')
  ok('.env written')

  // ── Install systemd service (Linux) ──────────────────────
  const platform = os.platform()
  if (platform === 'linux') {
    console.log(`\n${BOLD}Installing systemd service...${RESET}`)
    const installService = await ask('Install as systemd user service? (y/n):')
    if (installService.toLowerCase() === 'y') {
      await installSystemdService()
    }
  } else if (platform === 'darwin') {
    console.log(`\n${BOLD}Installing launchd service...${RESET}`)
    const installService = await ask('Install as launchd user agent? (y/n):')
    if (installService.toLowerCase() === 'y') {
      await installLaunchdService()
    }
  } else {
    warn('Windows detected. Install PM2 globally and run: pm2 start dist/index.js --name claudeclaw')
  }

  // ── Get chat ID ───────────────────────────────────────────
  console.log(`\n${BOLD}Getting your chat ID...${RESET}`)
  info('Starting bot briefly to get your chat ID...')
  info('Open Telegram, send a message to your bot, then come back here.')

  const startBot = spawnSync('node', ['dist/index.js'], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: 'ignore',
  })
  startBot.pid && info(`Bot process started (PID ${startBot.pid})`)

  await ask('After sending /chatid to your bot in Telegram, paste the ID here:')
    .then(async (chatId) => {
      if (chatId.trim()) {
        // Update .env
        let envContent = readFileSync(path.join(PROJECT_ROOT, '.env'), 'utf-8')
        envContent = envContent.replace('ALLOWED_CHAT_ID=', `ALLOWED_CHAT_ID=${chatId.trim()}`)
        writeFileSync(path.join(PROJECT_ROOT, '.env'), envContent)
        ok(`Chat ID ${chatId.trim()} saved`)
      }
    })

  // ── Done ──────────────────────────────────────────────────
  console.log(`\n${GREEN}${BOLD}Setup complete!${RESET}\n`)
  console.log('Next steps:')
  console.log('  1. Restart the bot: npm run start')
  if (platform === 'linux') {
    console.log('  2. Or via systemd: systemctl --user restart claudeclaw')
  }
  console.log('  3. Send a message to your bot in Telegram')
  console.log('\nNeed help? Ask me anything at any time.')

  rl.close()
}

async function installSystemdService(): Promise<void> {
  const serviceDir = path.join(os.homedir(), '.config', 'systemd', 'user')
  mkdirSync(serviceDir, { recursive: true })

  const serviceContent = `[Unit]
Description=ClaudeClaw Telegram Bot
After=network.target

[Service]
Type=simple
WorkingDirectory=${PROJECT_ROOT}
ExecStart=${process.execPath} ${path.join(PROJECT_ROOT, 'dist', 'index.js')}
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`

  const servicePath = path.join(serviceDir, 'claudeclaw.service')
  writeFileSync(servicePath, serviceContent)
  ok(`Service file written: ${servicePath}`)

  try {
    execSync('systemctl --user daemon-reload', { stdio: 'pipe' })
    execSync('systemctl --user enable claudeclaw', { stdio: 'pipe' })
    execSync('systemctl --user start claudeclaw', { stdio: 'pipe' })
    ok('systemd service enabled and started')
    info('Check status: systemctl --user status claudeclaw')
    info('View logs: journalctl --user -u claudeclaw -f')
  } catch (err) {
    warn(`systemctl commands failed: ${String(err)}`)
    info(`Manually run: systemctl --user enable claudeclaw && systemctl --user start claudeclaw`)
  }
}

async function installLaunchdService(): Promise<void> {
  const agentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents')
  mkdirSync(agentsDir, { recursive: true })

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.claudeclaw.app</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${path.join(PROJECT_ROOT, 'dist', 'index.js')}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${PROJECT_ROOT}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>/tmp/claudeclaw.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/claudeclaw.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
</dict>
</plist>
`

  const plistPath = path.join(agentsDir, 'com.claudeclaw.app.plist')
  writeFileSync(plistPath, plistContent)
  ok(`Plist written: ${plistPath}`)

  try {
    execSync(`launchctl load ${plistPath}`, { stdio: 'pipe' })
    ok('launchd agent loaded')
    info('View logs: tail -f /tmp/claudeclaw.log')
  } catch (err) {
    warn(`launchctl failed: ${String(err)}`)
    info(`Manually run: launchctl load ${plistPath}`)
  }
}

main().catch((err) => {
  console.error(`${RED}Fatal error:${RESET}`, err)
  process.exit(1)
})
