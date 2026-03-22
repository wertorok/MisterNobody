import { z } from 'zod'
import { execSync } from 'child_process'
import { sessionManager } from '../state/session-manager.js'
import { spawnCodex } from '../core/codex-process.js'
import { StreamParser } from '../core/stream-parser.js'
import { Buffer } from '../core/buffer.js'
import { classify } from '../core/request-classifier.js'
import { securityGuard } from '../middleware/security-guard.js'
import { PermissionCache } from '../middleware/permission-cache.js'
import { buildEffectivePrompt } from '../state/session-manager.js'
import { logger } from '../utils/logger.js'
import type { StreamEvent } from '../core/types.js'
import {
  CodexNotFoundError,
  CodexApiKeyMissingError,
} from '../core/types.js'

export const StartSessionInputSchema = z.object({
  task: z.string().min(1),
  plan: z.array(z.string()),
  working_dir: z.string().optional(),
  timeout_ms: z.number().positive().optional(),
  previous_summary: z.string().max(4800).optional(),
  task_lineage_id: z.string().uuid().optional(),
})

export type StartSessionInput = z.infer<typeof StartSessionInputSchema>

// In-memory registry: session_id → { handle, buffer, cache }
export interface SessionRuntime {
  handle: ReturnType<typeof spawnCodex>
  buffer: Buffer
  cache: PermissionCache
  parser: StreamParser
  pendingEvents: StreamEvent[]
  resolveNextEvent?: (event: StreamEvent) => void
}

export const sessionRuntimes = new Map<string, SessionRuntime>()

function checkEnvironment(): void {
  // Check codex in PATH
  try {
    execSync('which codex', { stdio: 'pipe' })
  } catch {
    try {
      execSync('npx @openai/codex --version', { stdio: 'pipe', timeout: 5000 })
    } catch {
      throw new CodexNotFoundError()
    }
  }

  // Check API key
  if (
    !process.env['OPENAI_API_KEY'] ||
    process.env['OPENAI_API_KEY'].trim().length === 0
  ) {
    throw new CodexApiKeyMissingError()
  }
}

export async function toolStartSession(input: StartSessionInput): Promise<{
  session_id: string
  task_lineage_id: string
}> {
  checkEnvironment()

  // Create session state
  const state = sessionManager.createSession({
    task: input.task,
    plan: input.plan,
    working_dir: input.working_dir,
    task_lineage_id: input.task_lineage_id,
    previous_summary: input.previous_summary,
  })

  const effectiveTask = buildEffectivePrompt(input.task, input.previous_summary)

  const buffer = new Buffer()
  const cache = new PermissionCache(state.working_dir)

  // Load task-scope rules from session state
  if (state.approved_patterns.length > 0) {
    cache.loadFromSessionState(state.approved_patterns)
  }

  const pendingEvents: StreamEvent[] = []
  let resolveNextEvent: ((event: StreamEvent) => void) | undefined

  const handle = spawnCodex({
    task: effectiveTask,
    workingDir: state.working_dir,
    onEvent: (event) => {
      // Accumulate buffer entries for reasoning
      if (event.type === 'line') {
        buffer.append({
          timestamp: event.timestamp,
          source: event.source,
          text: event.text,
        })
      }

      if (resolveNextEvent) {
        const resolve = resolveNextEvent
        resolveNextEvent = undefined
        resolve(event)
      } else {
        pendingEvents.push(event)
      }
    },
  })

  state.process_pid = handle.pid
  state.status = 'running'
  state.runtime_state = 'active'
  await sessionManager.updateSession(state)

  const runtime: SessionRuntime = {
    handle,
    buffer,
    cache,
    parser: handle.parser,
    pendingEvents,
  }
  Object.defineProperty(runtime, 'resolveNextEvent', {
    get: () => resolveNextEvent,
    set: (v: ((event: StreamEvent) => void) | undefined) => {
      resolveNextEvent = v
    },
    enumerable: true,
    configurable: true,
  })

  sessionRuntimes.set(state.session_id, runtime)

  // Set up timeout if specified
  if (input.timeout_ms) {
    setTimeout(async () => {
      const rt = sessionRuntimes.get(state.session_id)
      if (rt) {
        logger.warn(`Session ${state.session_id} timed out after ${input.timeout_ms}ms`)
        await rt.handle.kill()
        sessionRuntimes.delete(state.session_id)
        await sessionManager.endSession(state.session_id, 'interrupted')
      }
    }, input.timeout_ms)
  }

  logger.info(
    `Session started: ${state.session_id}, pid: ${handle.pid}`
  )

  return {
    session_id: state.session_id,
    task_lineage_id: state.task_lineage_id,
  }
}
