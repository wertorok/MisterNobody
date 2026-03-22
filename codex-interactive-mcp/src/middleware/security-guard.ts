import * as fs from 'fs'
import * as path from 'path'
import * as url from 'url'
import type {
  PermissionRequest,
  SessionState,
  SecurityVerdict,
  SecurityVerdictResult,
} from '../core/types.js'
import type { PermissionCache } from './permission-cache.js'
import { logger } from '../utils/logger.js'
import {
  RATE_LIMIT_WINDOW_SEC,
  RATE_LIMIT_MAX_REQUESTS,
} from '../config.js'

// ─── Security rules ───────────────────────────────────────────────────────────

interface SecurityRules {
  critical_commands: string[]
  critical_paths: string[]
  warning_commands: string[]
  warning_paths: string[]
  safe_auto_paths: string[]
}

function loadRules(): SecurityRules {
  try {
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
    const rulesPath = path.join(__dirname, '../../config/security-rules.json')
    const raw = fs.readFileSync(rulesPath, 'utf-8')
    return JSON.parse(raw) as SecurityRules
  } catch {
    logger.warn('Could not load security-rules.json, using defaults')
    return {
      critical_commands: [
        'rm -rf',
        'sudo ',
        'chmod 7',
        'curl.*\\|.*bash',
        'wget.*\\|.*sh',
        'ssh ',
        'scp ',
        'git push --force',
        'git reset --hard',
        'docker.*down.*-v',
        'kubectl delete',
        'DROP TABLE',
        'DELETE FROM',
      ],
      critical_paths: [
        '\\.env$',
        '\\.env\\.',
        'private\\.key',
        '\\.pem$',
        'id_rsa',
        '\\.ssh/',
        'secrets/',
        'credentials',
        '\\.npmrc$',
      ],
      warning_commands: [
        'mv ',
        'cp -r',
        'find.*-delete',
        'git commit',
        'npm publish',
        'npx ',
        'node ',
        'python ',
        'bash ',
        'sh ',
      ],
      warning_paths: [
        'package\\.json$',
        'package-lock\\.json$',
        'yarn\\.lock$',
        'tsconfig.*\\.json$',
        'dockerfile',
        '\\.github/',
        'migration',
        'schema\\.prisma',
        '\\.gitignore$',
      ],
      safe_auto_paths: [
        '\\.test\\.',
        '\\.spec\\.',
        '__tests__/',
        '__mocks__/',
        '\\.md$',
        '\\.txt$',
        '\\.log$',
        '\\.stories\\.',
        '\\.example\\.',
      ],
    }
  }
}

const RULES = loadRules()

function matchesAny(patterns: string[], target: string): string | null {
  // All patterns in security-rules.json are RegExp, not glob
  for (const pattern of patterns) {
    try {
      if (new RegExp(pattern).test(target)) return pattern
    } catch {
      logger.warn(`Invalid regex in security rules: ${pattern}`)
    }
  }
  return null
}

// ─── Security Guard ───────────────────────────────────────────────────────────
// Only deterministic rules. No external calls. Works only with PermissionRequest.

export class SecurityGuard {
  evaluate(
    request: PermissionRequest,
    cache: PermissionCache,
    state: SessionState
  ): SecurityVerdictResult {
    // ── 1. Rate limit check ───────────────────────────────────────────────
    const windowStart = new Date(
      Date.now() - RATE_LIMIT_WINDOW_SEC * 1000
    ).toISOString()

    const recentCount = state.recent_request_timestamps.filter(
      (ts) => ts >= windowStart
    ).length

    if (recentCount > RATE_LIMIT_MAX_REQUESTS) {
      logger.warn(
        `Rate limit exceeded: ${recentCount} requests in ${RATE_LIMIT_WINDOW_SEC}s`
      )
      return {
        verdict: 'BLOCK_AND_ALERT',
        reason: `permission_rate_limit_exceeded: ${recentCount} requests in ${RATE_LIMIT_WINDOW_SEC}s`,
      }
    }

    // ── 2. Cache check ────────────────────────────────────────────────────
    const cacheHit = cache.match(request)
    if (cacheHit) {
      logger.debug(
        `Security: cache hit for ${request.action} on ${request.normalized_target}`
      )
      return {
        verdict: 'AUTO_APPROVE',
        reason: `cache hit: ${cacheHit.pattern}`,
        matched_rule: cacheHit.pattern,
      }
    }

    const target = request.normalized_target

    // ── 3. Rule matching ──────────────────────────────────────────────────
    // critical → warning → safe_auto → unknown

    if (request.target_kind === 'command') {
      // Critical commands
      const critMatch = matchesAny(RULES.critical_commands, target)
      if (critMatch) {
        return {
          verdict: 'BLOCK_AND_ALERT',
          reason: `critical_command matched: ${critMatch}`,
          matched_rule: critMatch,
        }
      }

      // Warning commands
      const warnMatch = matchesAny(RULES.warning_commands, target)
      if (warnMatch) {
        return {
          verdict: 'NEEDS_CLAUDE',
          reason: `warning_command matched: ${warnMatch}`,
          matched_rule: warnMatch,
        }
      }

      // Unknown command
      return {
        verdict: 'NEEDS_CLAUDE',
        reason: 'unknown command — requires Claude review',
      }
    }

    if (request.target_kind === 'path') {
      // Critical paths
      const critMatch = matchesAny(RULES.critical_paths, target)
      if (critMatch) {
        return {
          verdict: 'BLOCK_AND_ALERT',
          reason: `critical_path matched: ${critMatch}`,
          matched_rule: critMatch,
        }
      }

      // Warning paths
      const warnMatch = matchesAny(RULES.warning_paths, target)
      if (warnMatch) {
        return {
          verdict: 'NEEDS_CLAUDE',
          reason: `warning_path matched: ${warnMatch}`,
          matched_rule: warnMatch,
        }
      }

      // Safe auto paths
      const safeMatch = matchesAny(RULES.safe_auto_paths, target)
      if (safeMatch) {
        // Cache check already happened above (step 2). Reaching here means no cache hit.
        // First occurrence → NEEDS_CLAUDE so Claude reads the reasoning, understands
        // what Codex is doing, and can create a cache rule for subsequent files.
        // Subsequent occurrences hit the cache at step 2 → AUTO_APPROVE without waking Claude.
        // Deletion always requires explicit confirmation regardless of cache.
        return {
          verdict: 'NEEDS_CLAUDE',
          reason: `safe_auto_path matched (no cache rule yet): ${safeMatch}`,
          matched_rule: safeMatch,
        }
      }

      // Unknown path
      return {
        verdict: 'NEEDS_CLAUDE',
        reason: 'unknown path — requires Claude review',
      }
    }

    // Unknown target kind
    return {
      verdict: 'NEEDS_CLAUDE',
      reason: 'unknown target_kind — requires Claude review',
    }
  }
}

export const securityGuard = new SecurityGuard()
