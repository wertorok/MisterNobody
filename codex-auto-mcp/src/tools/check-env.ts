import { execSync } from 'child_process'
import { z } from 'zod'

export const CheckEnvInputSchema = z.object({})
export type CheckEnvInput = z.infer<typeof CheckEnvInputSchema>

export interface EnvCheckResult {
  codex_available: boolean
  codex_version: string
  api_key_set: boolean
  node_version: string
  supported_flags: string[]
  pipe_compatible: boolean | 'unknown'
}

export async function toolCheckEnvironment(
  _input: CheckEnvInput
): Promise<EnvCheckResult> {
  let codexAvailable = false
  let codexVersion = 'unknown'

  // 1. Check codex in PATH
  try {
    codexVersion = execSync('codex --version', {
      timeout: 5000,
      encoding: 'utf-8',
    }).trim()
    codexAvailable = true
  } catch {
    // try npx
    try {
      codexVersion = execSync('npx @openai/codex --version', {
        timeout: 30000,
        encoding: 'utf-8',
      }).trim()
      codexAvailable = true
    } catch {
      codexAvailable = false
    }
  }

  // 2. Check API key
  const apiKeySet = Boolean(
    process.env['OPENAI_API_KEY'] &&
      process.env['OPENAI_API_KEY'].trim().length > 0
  )

  // 3. Node version
  const nodeVersion = process.version

  // 4. Supported flags
  const supportedFlags: string[] = []
  if (codexAvailable) {
    try {
      const helpText = execSync('codex exec --help', {
        timeout: 5000,
        encoding: 'utf-8',
      })
      if (helpText.includes('--json')) supportedFlags.push('--json')
      if (helpText.includes('--full-auto')) supportedFlags.push('--full-auto')
      if (helpText.includes('on-request')) supportedFlags.push('-a on-request')
      if (helpText.includes('never')) supportedFlags.push('-a never')
      if (helpText.includes('--quiet')) supportedFlags.push('--quiet')
    } catch {
      // skip
    }
  }

  // 5. Pipe compatibility test
  let pipeCompatible: boolean | 'unknown' = 'unknown'
  if (codexAvailable) {
    try {
      // Quick test: just check if exec subcommand is available
      execSync('codex exec --help', { timeout: 5000, stdio: 'pipe' })
      pipeCompatible = true
    } catch {
      pipeCompatible = false
    }
  }

  return {
    codex_available: codexAvailable,
    codex_version: codexVersion,
    api_key_set: apiKeySet,
    node_version: nodeVersion,
    supported_flags: supportedFlags,
    pipe_compatible: pipeCompatible,
  }
}
