import { z } from 'zod'
import { runCodex } from '../core/codex-runner.js'
import type { RunResult } from '../core/codex-runner.js'

export const CreateFileInputSchema = z.object({
  description: z.string().min(1),
  output_path: z.string().min(1),
  language: z.string().optional(),
  requirements: z.array(z.string()).optional(),
})

export type CreateFileInput = z.infer<typeof CreateFileInputSchema>

export async function toolCreateFile(input: CreateFileInput): Promise<RunResult> {
  const langHint = input.language ? ` in ${input.language}` : ''
  const reqs =
    input.requirements && input.requirements.length > 0
      ? `\nRequirements:\n${input.requirements.map((r) => `- ${r}`).join('\n')}`
      : ''

  const prompt = `Create file ${input.output_path}${langHint}: ${input.description}${reqs}`

  return runCodex({
    prompt,
    approval: 'full-auto',
  })
}
