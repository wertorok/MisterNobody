import { z } from 'zod'
import { runCodex } from '../core/codex-runner.js'
import type { RunResult } from '../core/codex-runner.js'
import * as path from 'path'

export const RefactorInputSchema = z.object({
  file_path: z.string().min(1),
  instructions: z.string().min(1),
  model: z.string().optional(),
})

export type RefactorInput = z.infer<typeof RefactorInputSchema>

export async function toolRefactor(input: RefactorInput): Promise<RunResult> {
  const workingDir = path.dirname(path.resolve(input.file_path))
  const prompt = `Refactor ${path.basename(input.file_path)}: ${input.instructions}`

  return runCodex({
    prompt,
    model: input.model,
    working_dir: workingDir,
    approval: 'full-auto',
  })
}
