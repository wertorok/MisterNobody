import { z } from 'zod'
import * as fs from 'fs'
import * as path from 'path'
import { getSessionDir } from '../state/session-manager.js'

export const GetRawChunkInputSchema = z.object({
  session_id: z.string(),
  cycle_id: z.string(), // NOT chunk_index
})

export type GetRawChunkInput = z.infer<typeof GetRawChunkInputSchema>

export async function toolGetRawChunk(input: GetRawChunkInput): Promise<{
  raw_text: string
  line_count: number
  cycle_id: string
}> {
  const sessionDir = getSessionDir(input.session_id)
  const chunkPath = path.join(sessionDir, 'cycles', `${input.cycle_id}.log`)

  try {
    const raw = fs.readFileSync(chunkPath, 'utf-8')
    const lines = raw.split('\n').filter(Boolean)
    return {
      raw_text: raw,
      line_count: lines.length,
      cycle_id: input.cycle_id,
    }
  } catch {
    throw new Error(
      `Raw chunk not found for cycle ${input.cycle_id} in session ${input.session_id}`
    )
  }
}
