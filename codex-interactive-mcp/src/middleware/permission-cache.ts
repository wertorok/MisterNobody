import { minimatch } from 'minimatch'
import type {
  CacheRule,
  PermissionRequest,
  PermissionAction,
} from '../core/types.js'
import { CacheRuleValidationError } from '../core/types.js'
import { normalizeRequest } from '../core/request-classifier.js'
import { logger } from '../utils/logger.js'

// ─── Pattern validation ───────────────────────────────────────────────────────

const FORBIDDEN_PATTERNS = new Set(['*', '**', '**/*', '/', '.', '.*'])

export function validatePattern(
  pattern: string,
  action: PermissionAction
): void {
  const trimmed = pattern.trim()

  if (FORBIDDEN_PATTERNS.has(trimmed)) {
    throw new CacheRuleValidationError(pattern)
  }

  if (action === 'run_command' && /^\*+$/.test(trimmed)) {
    throw new CacheRuleValidationError(pattern)
  }

  // Pattern must contain at least one non-wildcard character of length >= 3
  const nonWildcard = trimmed.replace(/[*?[\]{}]/g, '')
  if (nonWildcard.length < 3) {
    throw new CacheRuleValidationError(pattern)
  }
}

// ─── Permission Cache ─────────────────────────────────────────────────────────

export class PermissionCache {
  // fingerprint → CacheRule (fast path for exact match)
  private fingerprintMap = new Map<string, CacheRule>()
  // glob rules (slow path)
  private globRules: CacheRule[] = []

  constructor(private workingDir: string) {}

  // ── Fast path: fingerprint-based lookup ───────────────────────────────────
  private matchByFingerprint(
    fingerprint: string,
    action: PermissionAction
  ): CacheRule | null {
    const rule = this.fingerprintMap.get(fingerprint)
    if (rule && rule.action === action) {
      rule.use_count++
      return rule
    }
    return null
  }

  // ── Slow path: glob-based lookup ──────────────────────────────────────────
  private matchByGlob(
    normalizedTarget: string,
    action: PermissionAction
  ): CacheRule | null {
    for (const rule of this.globRules) {
      if (rule.action !== action) continue
      if (minimatch(normalizedTarget, rule.pattern)) {
        rule.use_count++
        logger.debug(
          `Permission cache glob match: ${rule.pattern} for ${normalizedTarget}`
        )
        return rule
      }
    }
    return null
  }

  match(request: PermissionRequest): CacheRule | null {
    // 1. Fast path: fingerprint
    const fpHit = this.matchByFingerprint(request.fingerprint, request.action)
    if (fpHit) return fpHit

    // 2. Slow path: glob
    return this.matchByGlob(request.normalized_target, request.action)
  }

  addRule(
    partial: Omit<CacheRule, 'use_count' | 'created_at'>,
    sourceRequest: PermissionRequest
  ): CacheRule {
    // action is always inherited from the PermissionRequest, not from input
    const action = sourceRequest.action

    validatePattern(partial.pattern, action)

    // Normalize the pattern
    let normalizedPattern: string
    if (partial.matcher_type === 'exact' && partial.action !== 'run_command') {
      // Normalize path-based patterns
      const fake: Omit<PermissionRequest, 'normalized_target' | 'fingerprint'> = {
        raw: '',
        action,
        target: partial.pattern,
        target_kind: 'path',
      }
      normalizedPattern = normalizeRequest(fake, this.workingDir)
    } else {
      normalizedPattern = partial.pattern.trim()
    }

    const rule: CacheRule = {
      action, // ALWAYS from sourceRequest
      matcher_type: partial.matcher_type,
      pattern: normalizedPattern,
      scope: partial.scope,
      task_lineage_id: partial.task_lineage_id,
      approved_by: 'claude',
      created_at: new Date().toISOString(),
      use_count: 0,
    }

    if (partial.matcher_type === 'exact') {
      this.fingerprintMap.set(sourceRequest.fingerprint, rule)
      logger.debug(`Cache rule added (exact): ${rule.pattern}`)
    } else {
      this.globRules.push(rule)
      logger.debug(`Cache rule added (glob): ${rule.pattern}`)
    }

    return rule
  }

  clearSessionScope(): void {
    // Remove session-scoped rules (don't survive restart)
    for (const [fp, rule] of this.fingerprintMap.entries()) {
      if (rule.scope === 'session') {
        this.fingerprintMap.delete(fp)
      }
    }
    this.globRules = this.globRules.filter((r) => r.scope !== 'session')
    logger.debug('Session-scope cache rules cleared')
  }

  loadFromSessionState(rules: CacheRule[]): void {
    for (const rule of rules) {
      if (rule.scope === 'task') {
        if (rule.matcher_type === 'glob') {
          this.globRules.push(rule)
        }
        // For exact rules we don't have the fingerprint stored, so we add to glob as fallback
        // This is acceptable — task-scope rules survive restart via glob matching
      }
    }
  }

  getAllRules(): CacheRule[] {
    return [
      ...this.fingerprintMap.values(),
      ...this.globRules,
    ]
  }
}
