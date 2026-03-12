import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')

export function readEnvFile(keys?: string[]): Record<string, string> {
  try {
    const envPath = path.join(PROJECT_ROOT, '.env')
    const content = readFileSync(envPath, 'utf-8')
    const result: Record<string, string> = {}

    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const eqIndex = trimmed.indexOf('=')
      if (eqIndex === -1) continue

      const key = trimmed.slice(0, eqIndex).trim()
      let value = trimmed.slice(eqIndex + 1).trim()

      // Handle quoted values
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }

      if (!keys || keys.includes(key)) {
        result[key] = value
      }
    }

    return result
  } catch {
    return {}
  }
}
