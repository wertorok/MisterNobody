/**
 * Integration test: full permission flow through the real MCP tool stack.
 *
 * Uses a mock Codex CLI (e2e/mock-codex.mjs) that produces 3 approval requests
 * for *.test.ts files. Tests the core behavioral fix:
 *
 *   File 1 (login.test.ts)    → NEEDS_CLAUDE  (safe_auto, no cache yet)
 *   File 2 (user.test.ts)     → AUTO_APPROVE  (cache hit: **\/*.test.ts)
 *   File 3 (format.test.ts)   → AUTO_APPROVE  (cache hit: **\/*.test.ts)
 *   Final                      → completed
 */

import * as path from 'path'
import * as fs from 'fs'
import * as url from 'url'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { toolStartSession } from '../../tools/start-session.js'
import { toolStreamUntilPermission } from '../../tools/stream-until-permission.js'
import { toolRespond } from '../../tools/respond.js'
import { toolEndSession } from '../../tools/end-session.js'

// ─── Setup ────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../../..')
const mockDir = path.resolve(projectRoot, 'e2e')
const mockBin = path.resolve(mockDir, 'mock-codex.mjs')

// Wrapper script so "codex" resolves in PATH without the .mjs extension
const mockWrapperPath = path.resolve(mockDir, 'codex')

let originalPath: string
let originalApiKey: string | undefined
let sessionId: string

beforeAll(() => {
  // Create a shell wrapper named "codex" that delegates to the .mjs script
  fs.writeFileSync(
    mockWrapperPath,
    `#!/bin/sh\nexec node "${mockBin}" "$@"\n`
  )
  fs.chmodSync(mockWrapperPath, '755')

  // Prepend mock dir to PATH so `which codex` finds our mock
  originalPath = process.env['PATH'] ?? ''
  process.env['PATH'] = `${mockDir}:${originalPath}`

  // checkEnvironment() requires OPENAI_API_KEY to be set
  originalApiKey = process.env['OPENAI_API_KEY']
  process.env['OPENAI_API_KEY'] = 'test-key-integration'
})

afterAll(async () => {
  // Restore env
  process.env['PATH'] = originalPath
  if (originalApiKey !== undefined) {
    process.env['OPENAI_API_KEY'] = originalApiKey
  } else {
    delete process.env['OPENAI_API_KEY']
  }

  // Remove wrapper
  try { fs.unlinkSync(mockWrapperPath) } catch { /* ok */ }

  // Clean up sessions dir created during test
  const sessionsDir = path.resolve(projectRoot, 'sessions')
  try { fs.rmSync(sessionsDir, { recursive: true, force: true }) } catch { /* ok */ }
})

// ─── Test ─────────────────────────────────────────────────────────────────────

describe('permission flow: safe_auto_paths + cache', () => {
  it(
    'first .test.ts → NEEDS_CLAUDE; subsequent → AUTO_APPROVE via cache',
    async () => {
      // ── Start session ────────────────────────────────────────────────────────
      const { session_id } = await toolStartSession({
        task: 'Write unit tests for auth, models and utils modules',
        plan: [
          '1. Create src/auth/__tests__/login.test.ts',
          '2. Create src/models/__tests__/user.test.ts',
          '3. Create src/utils/__tests__/format.test.ts',
        ],
        working_dir: '/tmp',
      })

      sessionId = session_id
      expect(session_id).toBeTruthy()

      // ── Round 1: login.test.ts → NEEDS_CLAUDE ───────────────────────────────
      const r1 = await toolStreamUntilPermission({ session_id })

      expect(r1).toMatchObject({ needs_claude: true })

      if (!('needs_claude' in r1)) throw new Error('expected needs_claude')

      const pkg1 = r1.summary_package
      expect(pkg1.permission_request.target).toContain('login.test.ts')
      expect(pkg1.permission_request.action).toBe('create_file')
      expect(r1.security_verdict.verdict).toBe('NEEDS_CLAUDE')
      expect(r1.security_verdict.reason).toContain('safe_auto_path matched (no cache rule yet)')

      // Claude approves and adds cache rule for all future *.test.ts files
      const respond1 = await toolRespond({
        session_id,
        response: 'y',
        rationale: 'Creating login.test.ts — step 1 of plan. Caching **/*.test.ts for session.',
        cache_rule: {
          pattern: '**/*.test.ts',
          matcher_type: 'glob',
          scope: 'session',
        },
      })
      expect(respond1.success).toBe(true)
      expect(respond1.cache_rule_added).toBeDefined()
      expect(respond1.cache_rule_added?.pattern).toBe('**/*.test.ts')

      // ── Round 2: user.test.ts → AUTO_APPROVE (cache hit) ────────────────────
      const r2 = await toolStreamUntilPermission({ session_id })

      expect(r2).toMatchObject({ auto_approved: true })

      if (!('auto_approved' in r2)) throw new Error('expected auto_approved')
      expect(r2.reason).toContain('cache hit')

      // ── Round 3: format.test.ts → AUTO_APPROVE (cache hit) ──────────────────
      const r3 = await toolStreamUntilPermission({ session_id })

      expect(r3).toMatchObject({ auto_approved: true })

      if (!('auto_approved' in r3)) throw new Error('expected auto_approved')
      expect(r3.reason).toContain('cache hit')

      // ── Round 4: session completed ───────────────────────────────────────────
      const r4 = await toolStreamUntilPermission({ session_id })

      expect(r4).toMatchObject({ completed: true })

      // ── Cleanup ──────────────────────────────────────────────────────────────
      await toolEndSession({ session_id, status: 'completed' })
    },
    15_000 // 15s timeout for full e2e flow
  )
})
