import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { logger } from './utils/logger.js'
import { RunInputSchema, toolRun } from './tools/run.js'
import { CreateFileInputSchema, toolCreateFile } from './tools/create-file.js'
import { RefactorInputSchema, toolRefactor } from './tools/refactor.js'
import { AskInputSchema, toolAsk } from './tools/ask.js'
import {
  CheckEnvInputSchema,
  toolCheckEnvironment,
} from './tools/check-env.js'
import type { RunResult } from './core/codex-runner.js'

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'codex-auto-mcp',
  version: '1.0.0',
})

// Helper to format RunResult for MCP response
function formatResult(result: RunResult): string {
  const parts: string[] = []
  if (result.stdout.trim()) parts.push(`stdout:\n${result.stdout.trim()}`)
  if (result.stderr.trim()) parts.push(`stderr:\n${result.stderr.trim()}`)
  parts.push(`exit_code: ${result.exit_code}`)
  parts.push(`success: ${result.success}`)
  parts.push(`duration_ms: ${result.duration_ms}`)
  if (result.failure_kind) parts.push(`failure_kind: ${result.failure_kind}`)
  return parts.join('\n\n')
}

// ─── Tool: codex_run ──────────────────────────────────────────────────────────
server.tool(
  'codex_run',
  'Run a Codex task in full-auto mode. Returns stdout, stderr, exit code and duration.',
  RunInputSchema.shape,
  async (input) => {
    logger.info(`codex_run: ${input.prompt.slice(0, 100)}`)
    const result = await toolRun(RunInputSchema.parse(input))
    return {
      content: [{ type: 'text', text: formatResult(result) }],
    }
  }
)

// ─── Tool: codex_create_file ──────────────────────────────────────────────────
server.tool(
  'codex_create_file',
  'Ask Codex to create a specific file. Runs in full-auto mode.',
  CreateFileInputSchema.shape,
  async (input) => {
    logger.info(`codex_create_file: ${input.output_path}`)
    const result = await toolCreateFile(CreateFileInputSchema.parse(input))
    return {
      content: [{ type: 'text', text: formatResult(result) }],
    }
  }
)

// ─── Tool: codex_refactor ─────────────────────────────────────────────────────
server.tool(
  'codex_refactor',
  'Ask Codex to refactor a file according to instructions. Runs in full-auto mode.',
  RefactorInputSchema.shape,
  async (input) => {
    logger.info(`codex_refactor: ${input.file_path}`)
    const result = await toolRefactor(RefactorInputSchema.parse(input))
    return {
      content: [{ type: 'text', text: formatResult(result) }],
    }
  }
)

// ─── Tool: codex_ask ─────────────────────────────────────────────────────────
server.tool(
  'codex_ask',
  'Ask Codex a question without modifying any files. Verifies filesystem integrity before and after. Returns failure_kind=filesystem_violation if any files were changed.',
  AskInputSchema.shape,
  async (input) => {
    logger.info(`codex_ask: ${input.question.slice(0, 100)}`)
    const result = await toolAsk(AskInputSchema.parse(input))
    return {
      content: [{ type: 'text', text: formatResult(result) }],
    }
  }
)

// ─── Tool: codex_check_environment ───────────────────────────────────────────
server.tool(
  'codex_check_environment',
  'Check if Codex CLI is available and properly configured.',
  CheckEnvInputSchema.shape,
  async (input) => {
    logger.info('codex_check_environment')
    const result = await toolCheckEnvironment(CheckEnvInputSchema.parse(input))
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  }
)

// ─── Graceful shutdown ────────────────────────────────────────────────────────
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down codex-auto-mcp...`)
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
  logger.info('codex-auto-mcp started (stdio transport)')
}

main().catch((err) => {
  logger.error('Failed to start server:', err)
  process.exit(1)
})
