import Database from 'better-sqlite3'
import path from 'path'
import { STORE_DIR } from './config.js'
import { logger } from './logger.js'

const DB_PATH = path.join(STORE_DIR, 'claudeclaw.db')

let db: Database.Database

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
  }
  return db
}

export function initDatabase(): void {
  const db = getDb()
  logger.info({ path: DB_PATH }, 'Initializing database')

  // Sessions
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      chat_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // Full memory: dual-sector with salience decay
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      topic_key TEXT,
      content TEXT NOT NULL,
      sector TEXT NOT NULL CHECK(sector IN ('semantic','episodic')),
      salience REAL NOT NULL DEFAULT 1.0,
      created_at INTEGER NOT NULL,
      accessed_at INTEGER NOT NULL
    )
  `)

  // FTS5 virtual table for memory search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      content='memories',
      content_rowid='id'
    )
  `)

  // Triggers to keep FTS in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
    END
  `)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
    END
  `)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
      INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
    END
  `)

  // Scheduler tasks
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule TEXT NOT NULL,
      next_run INTEGER NOT NULL,
      last_run INTEGER,
      last_result TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
      created_at INTEGER NOT NULL
    )
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_status_next_run
    ON scheduled_tasks(status, next_run)
  `)

  // WhatsApp outbox
  db.exec(`
    CREATE TABLE IF NOT EXISTS wa_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_jid TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      sent_at INTEGER
    )
  `)

  // WhatsApp messages
  db.exec(`
    CREATE TABLE IF NOT EXISTS wa_messages (
      id TEXT PRIMARY KEY,
      chat_jid TEXT NOT NULL,
      from_me INTEGER NOT NULL DEFAULT 0,
      body TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    )
  `)

  // WhatsApp message map (telegram msg → wa chat)
  db.exec(`
    CREATE TABLE IF NOT EXISTS wa_message_map (
      telegram_chat_id TEXT NOT NULL,
      wa_chat_jid TEXT NOT NULL,
      PRIMARY KEY (telegram_chat_id)
    )
  `)

  logger.info('Database initialized')
}

// Sessions
export function getSession(chatId: string): string | undefined {
  const row = getDb().prepare(
    'SELECT session_id FROM sessions WHERE chat_id = ?'
  ).get(chatId) as { session_id: string } | undefined
  return row?.session_id
}

export function setSession(chatId: string, sessionId: string): void {
  getDb().prepare(`
    INSERT INTO sessions (chat_id, session_id, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at
  `).run(chatId, sessionId, Date.now())
}

export function clearSession(chatId: string): void {
  getDb().prepare('DELETE FROM sessions WHERE chat_id = ?').run(chatId)
}

// Memory CRUD
export function insertMemory(
  chatId: string,
  content: string,
  sector: 'semantic' | 'episodic',
  topicKey?: string
): void {
  const now = Date.now()
  getDb().prepare(`
    INSERT INTO memories (chat_id, topic_key, content, sector, salience, created_at, accessed_at)
    VALUES (?, ?, ?, ?, 1.0, ?, ?)
  `).run(chatId, topicKey ?? null, content, sector, now, now)
}

export function searchMemoriesFTS(
  chatId: string,
  query: string,
  limit = 3
): Array<{ id: number; content: string; sector: string }> {
  return getDb().prepare(`
    SELECT m.id, m.content, m.sector
    FROM memories_fts
    JOIN memories m ON memories_fts.rowid = m.id
    WHERE memories_fts MATCH ?
    AND m.chat_id = ?
    ORDER BY rank
    LIMIT ?
  `).all(query, chatId, limit) as Array<{ id: number; content: string; sector: string }>
}

export function getRecentMemories(
  chatId: string,
  limit = 5
): Array<{ id: number; content: string; sector: string }> {
  return getDb().prepare(`
    SELECT id, content, sector
    FROM memories
    WHERE chat_id = ?
    ORDER BY accessed_at DESC
    LIMIT ?
  `).all(chatId, limit) as Array<{ id: number; content: string; sector: string }>
}

export function touchMemory(id: number): void {
  getDb().prepare(`
    UPDATE memories
    SET accessed_at = ?, salience = MIN(salience + 0.1, 5.0)
    WHERE id = ?
  `).run(Date.now(), id)
}

export function decayMemories(): void {
  const dayAgo = Date.now() - 86400 * 1000
  getDb().prepare(`
    UPDATE memories SET salience = salience * 0.98
    WHERE created_at < ?
  `).run(dayAgo)
  getDb().prepare('DELETE FROM memories WHERE salience < 0.1').run()
}

export function getAllMemories(chatId: string): Array<{ content: string; sector: string; salience: number }> {
  return getDb().prepare(`
    SELECT content, sector, salience FROM memories
    WHERE chat_id = ?
    ORDER BY accessed_at DESC
  `).all(chatId) as Array<{ content: string; sector: string; salience: number }>
}

export function clearMemories(chatId: string): void {
  getDb().prepare('DELETE FROM memories WHERE chat_id = ?').run(chatId)
}

// Scheduler
export function createTask(task: {
  id: string
  chatId: string
  prompt: string
  schedule: string
  nextRun: number
}): void {
  getDb().prepare(`
    INSERT INTO scheduled_tasks (id, chat_id, prompt, schedule, next_run, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(task.id, task.chatId, task.prompt, task.schedule, task.nextRun, Date.now())
}

export function getDueTasks(): Array<{
  id: string
  chat_id: string
  prompt: string
  schedule: string
}> {
  const now = Math.floor(Date.now() / 1000)
  return getDb().prepare(`
    SELECT id, chat_id, prompt, schedule
    FROM scheduled_tasks
    WHERE status = 'active' AND next_run <= ?
  `).all(now) as Array<{ id: string; chat_id: string; prompt: string; schedule: string }>
}

export function updateTaskAfterRun(id: string, lastResult: string, nextRun: number): void {
  getDb().prepare(`
    UPDATE scheduled_tasks
    SET last_run = ?, last_result = ?, next_run = ?
    WHERE id = ?
  `).run(Math.floor(Date.now() / 1000), lastResult, nextRun, id)
}

export function listTasks(): Array<{
  id: string
  chat_id: string
  prompt: string
  schedule: string
  next_run: number
  last_run: number | null
  status: string
}> {
  return getDb().prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC').all() as Array<{
    id: string
    chat_id: string
    prompt: string
    schedule: string
    next_run: number
    last_run: number | null
    status: string
  }>
}

export function deleteTask(id: string): void {
  getDb().prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id)
}

export function setTaskStatus(id: string, status: 'active' | 'paused'): void {
  getDb().prepare('UPDATE scheduled_tasks SET status = ? WHERE id = ?').run(status, id)
}

// WhatsApp
export function queueWaMessage(chatJid: string, message: string): void {
  getDb().prepare(`
    INSERT INTO wa_outbox (chat_jid, message, created_at)
    VALUES (?, ?, ?)
  `).run(chatJid, message, Date.now())
}

export function getPendingWaMessages(): Array<{ id: number; chat_jid: string; message: string }> {
  return getDb().prepare(`
    SELECT id, chat_jid, message FROM wa_outbox WHERE sent_at IS NULL ORDER BY created_at
  `).all() as Array<{ id: number; chat_jid: string; message: string }>
}

export function markWaMessageSent(id: number): void {
  getDb().prepare('UPDATE wa_outbox SET sent_at = ? WHERE id = ?').run(Date.now(), id)
}

export function saveWaMessage(id: string, chatJid: string, fromMe: boolean, body: string, timestamp: number): void {
  getDb().prepare(`
    INSERT OR REPLACE INTO wa_messages (id, chat_jid, from_me, body, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, chatJid, fromMe ? 1 : 0, body, timestamp)
}

export function getWaMessages(chatJid: string, limit = 20): Array<{ from_me: number; body: string; timestamp: number }> {
  return getDb().prepare(`
    SELECT from_me, body, timestamp FROM wa_messages
    WHERE chat_jid = ? ORDER BY timestamp DESC LIMIT ?
  `).all(chatJid, limit) as Array<{ from_me: number; body: string; timestamp: number }>
}

export function setWaActiveChatForTelegram(telegramChatId: string, waJid: string): void {
  getDb().prepare(`
    INSERT INTO wa_message_map (telegram_chat_id, wa_chat_jid)
    VALUES (?, ?)
    ON CONFLICT(telegram_chat_id) DO UPDATE SET wa_chat_jid = excluded.wa_chat_jid
  `).run(telegramChatId, waJid)
}

export function getWaActiveChatForTelegram(telegramChatId: string): string | undefined {
  const row = getDb().prepare(
    'SELECT wa_chat_jid FROM wa_message_map WHERE telegram_chat_id = ?'
  ).get(telegramChatId) as { wa_chat_jid: string } | undefined
  return row?.wa_chat_jid
}
