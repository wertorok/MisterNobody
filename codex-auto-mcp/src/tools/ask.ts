import { z } from 'zod'
import {
  runCodex,
  chooseIntegrityChecker,
  gitStatusBefore,
  detectGitChanges,
  captureSnapshot,
  detectSnapshotChanges,
} from '../core/codex-runner.js'
import type { RunResult } from '../core/codex-runner.js'
import { logger } from '../utils/logger.js'

// Re-export the constant for use here
const SNAPSHOT_IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.venv',
  'venv',
  '__pycache__',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.cache',
  'coverage',
  '.nyc_output',
  '.tox',
  'target',
])

export const AskInputSchema = z.object({
  question: z.string().min(1),
  context_files: z.array(z.string()).optional(),
  model: z.string().optional(),
  working_dir: z.string().optional(),
})

export type AskInput = z.infer<typeof AskInputSchema>

export async function toolAsk(input: AskInput): Promise<RunResult> {
  const workingDir = input.working_dir ?? process.cwd()
  const contextHint =
    input.context_files && input.context_files.length > 0
      ? `\nContext files: ${input.context_files.join(', ')}`
      : ''
  const prompt = `Answer this question without modifying any files: ${input.question}${contextHint}`

  const method = chooseIntegrityChecker(workingDir)
  logger.debug(`codex_ask: using ${method} integrity check in ${workingDir}`)

  if (method === 'git') {
    const beforeStatus = gitStatusBefore(workingDir)

    const result = await runCodex({
      prompt,
      model: input.model,
      working_dir: workingDir,
      approval: 'never',
    })

    const { execSync } = await import('child_process')
    let afterStatus = ''
    try {
      afterStatus = execSync('git status --porcelain -uall', {
        cwd: workingDir,
        timeout: 2000,
        encoding: 'utf-8',
      })
    } catch {
      afterStatus = ''
    }

    const changes = detectGitChanges(beforeStatus, afterStatus)
    if (changes.length > 0) {
      logger.warn(
        `codex_ask detected ${changes.length} filesystem changes: ${changes.join(', ')}`
      )
      return {
        ...result,
        success: false,
        failure_kind: 'filesystem_violation',
        stderr: `codex_ask detected ${changes.length} filesystem changes: ${changes.join(', ')}`,
      }
    }

    return result
  } else {
    // Snapshot fallback
    const { snapshot, tooLarge } = await captureSnapshot(
      workingDir,
      SNAPSHOT_IGNORE_DIRS
    )

    if (tooLarge) {
      logger.warn(
        `codex_ask: snapshot too large (>${50_000} files) in ${workingDir}`
      )
      return {
        stdout: '',
        stderr: `codex_ask: working directory contains more than 50,000 files — cannot verify filesystem integrity`,
        exit_code: -1,
        success: false,
        duration_ms: 0,
        failure_kind: 'snapshot_too_large',
      }
    }

    const result = await runCodex({
      prompt,
      model: input.model,
      working_dir: workingDir,
      approval: 'never',
    })

    const changes = await detectSnapshotChanges(
      workingDir,
      snapshot,
      SNAPSHOT_IGNORE_DIRS
    )
    if (changes.length > 0) {
      logger.warn(
        `codex_ask detected ${changes.length} filesystem changes: ${changes.join(', ')}`
      )
      return {
        ...result,
        success: false,
        failure_kind: 'filesystem_violation',
        stderr: `codex_ask detected ${changes.length} filesystem changes: ${changes.join(', ')}`,
      }
    }

    return result
  }
}
