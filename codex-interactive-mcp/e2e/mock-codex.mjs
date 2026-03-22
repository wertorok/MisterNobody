#!/usr/bin/env node
/**
 * Mock Codex CLI for integration testing.
 *
 * Simulates: codex exec --json -a on-request --skip-git-repo-check "<task>"
 *
 * Protocol:
 *   1. Output reasoning lines to stdout
 *   2. Output JSON approval_request line and wait for y/n on stdin
 *   3. On 'y': continue to next approval
 *   4. On 'n': exit 1
 *   5. After all approvals: output session_completed and exit 0
 */

import { createInterface } from 'readline'

const rl = createInterface({ input: process.stdin, terminal: false })

// Buffered lines from stdin (for async reads)
const stdinLines = []
let waitingResolve = null

rl.on('line', (line) => {
  if (waitingResolve) {
    const resolve = waitingResolve
    waitingResolve = null
    resolve(line.trim())
  } else {
    stdinLines.push(line.trim())
  }
})

function readLine() {
  if (stdinLines.length > 0) return Promise.resolve(stdinLines.shift())
  return new Promise((resolve) => { waitingResolve = resolve })
}

// ─── Scenario: 3 test file approvals ─────────────────────────────────────────

const approvals = [
  { action: 'create_file', path: 'src/auth/__tests__/login.test.ts' },
  { action: 'create_file', path: 'src/models/__tests__/user.test.ts' },
  { action: 'create_file', path: 'src/utils/__tests__/format.test.ts' },
]

process.stdout.write('Analyzing task: write unit tests for the auth module\n')
process.stdout.write('Planning to create test files for auth, models, utils\n')

for (const req of approvals) {
  // Output reasoning before each approval
  process.stdout.write(`I need to create ${req.path} to cover the module\n`)

  // Output approval_request in JSON format (as codex exec --json produces)
  process.stdout.write(
    JSON.stringify({ type: 'approval_request', action: req.action, path: req.path }) + '\n'
  )

  // Wait for y/n response
  const response = await readLine()

  if (response !== 'y') {
    process.stderr.write(`Approval denied for ${req.path}: "${response}"\n`)
    process.exit(1)
  }
}

// All approvals granted — signal completion
process.stdout.write(
  JSON.stringify({ type: 'session_completed', summary: 'Created 3 test files successfully' }) + '\n'
)

rl.close()
process.exit(0)
