import { z } from 'zod'
import { runCodex } from '../core/codex-runner.js'
import type { RunResult } from '../core/codex-runner.js'

export const RunInputSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
  working_dir: z.string().optional(),
  timeout_ms: z.number().positive().optional(),
})

export type RunInput = z.infer<typeof RunInputSchema>

export async function toolRun(input: RunInput): Promise<RunResult> {
  return runCodex({
    prompt: input.prompt,
    model: input.model,
    working_dir: input.working_dir,
    timeout_ms: input.timeout_ms,
    approval: 'full-auto',
  })
}
