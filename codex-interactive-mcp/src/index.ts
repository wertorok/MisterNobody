import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { logger } from './utils/logger.js'
import { sessionRuntimes } from './tools/start-session.js'
import { sessionManager } from './state/session-manager.js'
import { killProcessTree } from './core/codex-process.js'

import {
  StartSessionInputSchema,
  toolStartSession,
} from './tools/start-session.js'
import {
  StreamUntilPermissionInputSchema,
  toolStreamUntilPermission,
} from './tools/stream-until-permission.js'
import { RespondInputSchema, toolRespond } from './tools/respond.js'
import { GetStateInputSchema, toolGetState } from './tools/get-state.js'
import {
  GetRawChunkInputSchema,
  toolGetRawChunk,
} from './tools/get-raw-chunk.js'
import { EndSessionInputSchema, toolEndSession } from './tools/end-session.js'

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'codex-interactive-mcp',
  version: '1.0.0',
})

// ─── Tool: codex_start_session ────────────────────────────────────────────────
server.tool(
  'codex_start_session',
  'Start a new interactive Codex session. Claude will act as the operator, reviewing permission requests and making decisions. Returns session_id for subsequent calls.',
  StartSessionInputSchema.shape,
  async (input) => {
    logger.info(`codex_start_session: ${input.task.slice(0, 100)}`)
    const result = await toolStartSession(StartSessionInputSchema.parse(input))
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  }
)

// ─── Tool: codex_stream_until_permission ──────────────────────────────────────
server.tool(
  'codex_stream_until_permission',
  'Stream Codex output until a permission request is encountered. Returns either auto_approved (cache hit), needs_claude (review required), completed, or error. Claude wakes up ONLY for needs_claude results.',
  StreamUntilPermissionInputSchema.shape,
  async (input) => {
    logger.info(`codex_stream_until_permission: session=${input.session_id}`)
    const result = await toolStreamUntilPermission(
      StreamUntilPermissionInputSchema.parse(input)
    )
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  }
)

// ─── Tool: codex_respond ──────────────────────────────────────────────────────
server.tool(
  'codex_respond',
  "Respond to a Codex permission request. Use response='y' to approve, 'n' to reject. instruction is REQUIRED when response='n'. Optionally add a cache_rule to auto-approve similar future requests. Uses mutex to prevent race conditions.",
  RespondInputSchema.shape,
  async (input) => {
    logger.info(
      `codex_respond: session=${input.session_id}, response=${input.response}`
    )
    const result = await toolRespond(RespondInputSchema.parse(input))
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  }
)

// ─── Tool: codex_get_state ────────────────────────────────────────────────────
server.tool(
  'codex_get_state',
  'Get current session state and path to decisions log. If session_id is not provided, returns the most recently updated session.',
  GetStateInputSchema.shape,
  async (input) => {
    logger.info(`codex_get_state: session=${input.session_id ?? 'latest'}`)
    const result = await toolGetState(GetStateInputSchema.parse(input))
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  }
)

// ─── Tool: codex_get_raw_chunk ────────────────────────────────────────────────
server.tool(
  'codex_get_raw_chunk',
  "Get the full raw output chunk for a specific permission cycle. This is a Claude-triggered fallback — use ONLY when the reasoning_chunk in SummaryPackage is insufficient to make an explainable decision. Requires cycle_id (not chunk_index).",
  GetRawChunkInputSchema.shape,
  async (input) => {
    logger.info(
      `codex_get_raw_chunk: session=${input.session_id}, cycle=${input.cycle_id}`
    )
    const result = await toolGetRawChunk(GetRawChunkInputSchema.parse(input))
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  }
)

// ─── Tool: codex_end_session ──────────────────────────────────────────────────
server.tool(
  'codex_end_session',
  "End a Codex session. Kills the entire process tree (not just parent), generates a previous_summary for recovery, and clears session-scope cache rules. Use status='completed' when done, 'cancelled' when aborting.",
  EndSessionInputSchema.shape,
  async (input) => {
    logger.info(
      `codex_end_session: session=${input.session_id}, status=${input.status}`
    )
    const result = await toolEndSession(EndSessionInputSchema.parse(input))
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  }
)

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down codex-interactive-mcp...`)

  const activeSessions = sessionManager.getActiveSessions()
  for (const state of activeSessions) {
    logger.info(`Terminating session ${state.session_id}`)
    const rt = sessionRuntimes.get(state.session_id)
    if (rt && state.process_pid) {
      await killProcessTree(state.process_pid)
      rt.parser.destroy()
    }
    await sessionManager.endSession(state.session_id, 'interrupted')
  }

  process.exit(0)
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => void gracefulShutdown('SIGINT'))
process.on('uncaughtException', async (err) => {
  logger.error('Uncaught exception:', err)
  await gracefulShutdown('uncaughtException')
})
process.on('unhandledRejection', async (reason) => {
  logger.error('Unhandled rejection:', reason)
  await gracefulShutdown('unhandledRejection')
})

// ─── Start ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  logger.info('codex-interactive-mcp started (stdio transport)')
}

main().catch((err) => {
  logger.error('Failed to start server:', err)
  process.exit(1)
})
