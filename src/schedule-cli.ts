import { randomUUID } from 'crypto'
import { initDatabase, createTask, listTasks, deleteTask, setTaskStatus } from './db.js'
import { computeNextRun } from './scheduler.js'

initDatabase()

const [,, cmd, ...args] = process.argv

function printHelp(): void {
  console.log(`
ClaudeClaw Schedule CLI

Commands:
  create "<prompt>" "<cron>" <chat_id>  Create a new task
  list                                   List all tasks
  delete <id>                            Delete a task
  pause <id>                             Pause a task
  resume <id>                            Resume a paused task

Examples:
  node dist/schedule-cli.js create "Summarize my emails" "0 9 * * *" 123456789
  node dist/schedule-cli.js list
  node dist/schedule-cli.js pause abc-123
`)
}

function formatDate(unix: number | null): string {
  if (!unix) return 'never'
  return new Date(unix * 1000).toLocaleString()
}

switch (cmd) {
  case 'create': {
    const [prompt, schedule, chatId] = args
    if (!prompt || !schedule || !chatId) {
      console.error('Usage: create "<prompt>" "<cron>" <chat_id>')
      process.exit(1)
    }
    let nextRun: number
    try {
      nextRun = computeNextRun(schedule)
    } catch {
      console.error(`Invalid cron expression: ${schedule}`)
      process.exit(1)
    }
    const id = randomUUID().slice(0, 8)
    createTask({ id, chatId, prompt, schedule, nextRun })
    console.log(`Created task ${id}`)
    console.log(`Next run: ${formatDate(nextRun)}`)
    break
  }

  case 'list': {
    const tasks = listTasks()
    if (tasks.length === 0) {
      console.log('No tasks scheduled.')
      break
    }
    console.log('\nScheduled Tasks:')
    console.log('─'.repeat(80))
    for (const t of tasks) {
      console.log(`ID:       ${t.id}`)
      console.log(`Prompt:   ${t.prompt.slice(0, 60)}`)
      console.log(`Schedule: ${t.schedule}`)
      console.log(`Status:   ${t.status}`)
      console.log(`Next run: ${formatDate(t.next_run)}`)
      console.log(`Last run: ${formatDate(t.last_run)}`)
      console.log('─'.repeat(80))
    }
    break
  }

  case 'delete': {
    const [id] = args
    if (!id) { console.error('Usage: delete <id>'); process.exit(1) }
    deleteTask(id)
    console.log(`Deleted task ${id}`)
    break
  }

  case 'pause': {
    const [id] = args
    if (!id) { console.error('Usage: pause <id>'); process.exit(1) }
    setTaskStatus(id, 'paused')
    console.log(`Paused task ${id}`)
    break
  }

  case 'resume': {
    const [id] = args
    if (!id) { console.error('Usage: resume <id>'); process.exit(1) }
    setTaskStatus(id, 'active')
    console.log(`Resumed task ${id}`)
    break
  }

  default:
    printHelp()
}
