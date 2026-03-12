import { parseExpression } from 'cron-parser'
import { getDueTasks, updateTaskAfterRun } from './db.js'
import { runAgent } from './agent.js'
import { logger } from './logger.js'

export type Sender = (chatId: string, text: string) => Promise<void>

let sender: Sender
let interval: ReturnType<typeof setInterval>

export function computeNextRun(cronExpression: string): number {
  const expr = parseExpression(cronExpression)
  return Math.floor(expr.next().getTime() / 1000)
}

export async function runDueTasks(): Promise<void> {
  const tasks = getDueTasks()
  if (tasks.length === 0) return

  for (const task of tasks) {
    logger.info({ taskId: task.id, prompt: task.prompt.slice(0, 50) }, 'Running scheduled task')
    try {
      await sender(task.chat_id, `⏰ Running scheduled task: ${task.prompt.slice(0, 80)}...`)
      const { text } = await runAgent(task.prompt)
      const result = text ?? '(no response)'
      const nextRun = computeNextRun(task.schedule)
      updateTaskAfterRun(task.id, result, nextRun)
      await sender(task.chat_id, result)
    } catch (err) {
      logger.error({ err, taskId: task.id }, 'Scheduled task failed')
      try {
        await sender(task.chat_id, `❌ Scheduled task failed: ${String(err)}`)
      } catch {}
    }
  }
}

export function initScheduler(send: Sender): void {
  sender = send
  interval = setInterval(() => {
    runDueTasks().catch(err => logger.error({ err }, 'Scheduler tick error'))
  }, 60_000)
  logger.info('Scheduler started (60s polling)')
}

export function stopScheduler(): void {
  if (interval) clearInterval(interval)
}
