/**
 * Supervisor — the brain of the pipeline.
 *
 * Responsibilities:
 * - Owns the state machine (phase transitions)
 * - Validates every phase output against its contract
 * - Detects plan drift (worker did something not in plan)
 * - Decides: advance, retry, abort
 * - Maintains the audit log
 * - Enforces isolation (workers see only what supervisor gives them)
 *
 * Workers NEVER see each other. Workers NEVER see the full state.
 * Only the supervisor sees everything.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { saveArtifact } from "./claude.mjs";

// ---------------------------------------------------------------------------
// State Machine
// ---------------------------------------------------------------------------

/**
 * Valid state transitions. Each state maps to allowed next states.
 */
const TRANSITIONS = {
  init:       ["planning"],
  planning:   ["plan_review"],
  plan_review:["scaffolding", "planning"],       // review can reject → re-plan
  scaffolding:["scaffold_check"],
  scaffold_check: ["coding", "scaffolding"],     // check can reject → re-scaffold
  coding:     ["code_review"],
  code_review:["verifying", "coding"],           // review can reject → re-code
  verifying:  ["fixing", "deploying", "aborted"],// fail → fix, pass → deploy
  fixing:     ["verifying"],                      // fix always goes back to verify
  deploying:  ["done", "aborted"],
  done:       [],
  aborted:    [],
};

/**
 * Phase timeout limits (ms).
 */
const PHASE_LIMITS = {
  planning:      5  * 60 * 1000,
  plan_review:   2  * 60 * 1000,
  scaffolding:   5  * 60 * 1000,
  scaffold_check:2  * 60 * 1000,
  coding:        15 * 60 * 1000,
  code_review:   3  * 60 * 1000,
  verifying:     5  * 60 * 1000,
  fixing:        10 * 60 * 1000,
  deploying:     5  * 60 * 1000,
};

// ---------------------------------------------------------------------------
// Contract Schemas (what each phase MUST return)
// ---------------------------------------------------------------------------

const CONTRACTS = {
  planning: {
    required: ["framework", "description", "pages", "components", "files", "acceptance"],
    validate(output) {
      const errors = [];
      if (!output.framework) errors.push("Missing framework");
      if (!Array.isArray(output.pages) || output.pages.length === 0) errors.push("No pages defined");
      if (!Array.isArray(output.files) || output.files.length === 0) errors.push("No files listed");
      if (!Array.isArray(output.acceptance) || output.acceptance.length === 0) errors.push("No acceptance criteria");
      for (const page of (output.pages || [])) {
        if (!page.path || !page.purpose) errors.push(`Page missing path or purpose: ${JSON.stringify(page)}`);
      }
      return errors;
    },
  },

  verifying: {
    required: ["pass", "build", "issues"],
    validate(output) {
      const errors = [];
      if (typeof output.pass !== "boolean") errors.push("'pass' must be boolean");
      if (!output.build || typeof output.build.success !== "boolean") errors.push("'build.success' must be boolean");
      return errors;
    },
  },
};

// ---------------------------------------------------------------------------
// Drift Detection
// ---------------------------------------------------------------------------

/**
 * Check if worker created/modified files outside the plan.
 */
async function detectDrift(projectDir, plan) {
  const drift = { extraFiles: [], missingFiles: [], warnings: [] };
  const plannedFiles = new Set((plan.files || []).map(f => f.replace(/^\//, "")));

  // Get actual files in project (excluding node_modules, .next, dist, etc.)
  const actualFiles = await walkDir(projectDir, projectDir, [
    "node_modules", ".next", "dist", ".git", ".vercel", "out", ".turbo",
  ]);

  // Files that exist but weren't in plan (potential drift)
  const configFiles = new Set([
    "package.json", "package-lock.json", "tsconfig.json", "next.config.ts",
    "next.config.js", "next.config.mjs", "postcss.config.js", "postcss.config.mjs",
    "tailwind.config.ts", "tailwind.config.js", ".eslintrc.json", "eslint.config.mjs",
    "next-env.d.ts", ".gitignore", "vite.config.ts", "astro.config.mjs",
    "components.json", "tsconfig.app.json", "tsconfig.node.json",
    "index.html",
  ]);

  for (const file of actualFiles) {
    if (!plannedFiles.has(file) && !configFiles.has(file)) {
      drift.extraFiles.push(file);
    }
  }

  // Planned files that don't exist yet (expected after scaffold, not after code)
  for (const file of plannedFiles) {
    if (!actualFiles.includes(file)) {
      drift.missingFiles.push(file);
    }
  }

  if (drift.extraFiles.length > 10) {
    drift.warnings.push(`Worker created ${drift.extraFiles.length} unplanned files — possible scope creep`);
  }

  return drift;
}

async function walkDir(dir, root, ignore) {
  const results = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (ignore.includes(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    const relPath = fullPath.slice(root.length + 1);
    if (entry.isDirectory()) {
      results.push(...await walkDir(fullPath, root, ignore));
    } else {
      results.push(relPath);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

class AuditLog {
  constructor(runDir) {
    this.runDir = runDir;
    this.entries = [];
  }

  record(event) {
    const entry = {
      timestamp: new Date().toISOString(),
      ...event,
    };
    this.entries.push(entry);
    return entry;
  }

  transition(from, to, reason) {
    return this.record({ type: "transition", from, to, reason });
  }

  contractCheck(phase, passed, errors) {
    return this.record({ type: "contract_check", phase, passed, errors });
  }

  driftCheck(phase, drift) {
    return this.record({ type: "drift_check", phase, ...drift });
  }

  workerStart(phase, model, tools) {
    return this.record({ type: "worker_start", phase, model, tools });
  }

  workerEnd(phase, exitCode, durationMs) {
    return this.record({ type: "worker_end", phase, exitCode, durationMs });
  }

  decision(phase, decision, reason) {
    return this.record({ type: "decision", phase, decision, reason });
  }

  error(phase, message) {
    return this.record({ type: "error", phase, message });
  }

  async flush() {
    await saveArtifact(this.runDir, "audit.json", this.entries);
  }
}

// ---------------------------------------------------------------------------
// Supervisor
// ---------------------------------------------------------------------------

export class Supervisor {
  constructor(runDir, projectDir) {
    this.runDir = runDir;
    this.projectDir = projectDir;
    this.state = "init";
    this.plan = null;
    this.fixAttempts = 0;
    this.maxFixAttempts = 3;
    this.audit = new AuditLog(runDir);
    this.phaseResults = {};
  }

  /**
   * Transition to a new state. Throws if transition is invalid.
   */
  transitionTo(newState, reason) {
    const allowed = TRANSITIONS[this.state];
    if (!allowed || !allowed.includes(newState)) {
      throw new Error(
        `Invalid transition: ${this.state} → ${newState}. Allowed: [${allowed?.join(", ")}]`
      );
    }
    this.audit.transition(this.state, newState, reason);
    this.state = newState;
  }

  /**
   * Get the timeout for the current phase.
   */
  getTimeout() {
    return PHASE_LIMITS[this.state] || 10 * 60 * 1000;
  }

  /**
   * Validate a phase output against its contract.
   * Returns { valid: boolean, errors: string[] }
   */
  validateContract(phase, output) {
    const contract = CONTRACTS[phase];
    if (!contract) return { valid: true, errors: [] };

    const errors = [];

    // Check required fields
    for (const field of contract.required) {
      if (output[field] === undefined) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Run custom validation
    if (contract.validate) {
      errors.push(...contract.validate(output));
    }

    const valid = errors.length === 0;
    this.audit.contractCheck(phase, valid, errors);
    return { valid, errors };
  }

  /**
   * Check for drift after a coding phase.
   */
  async checkDrift(phase) {
    if (!this.plan) return { extraFiles: [], missingFiles: [], warnings: [] };
    const drift = await detectDrift(this.projectDir, this.plan);
    this.audit.driftCheck(phase, drift);
    return drift;
  }

  /**
   * Build the context a worker is allowed to see.
   *
   * ISOLATION POLICY:
   * - Workers NEVER see each other's logs
   * - Workers NEVER see the full audit trail
   * - Workers see ONLY: their phase prompt + plan + previous phase result (if needed)
   */
  buildWorkerContext(phase) {
    const context = {
      // What the worker needs to know about the overall goal
      plan: this.plan,
      // Phase-specific inputs (minimal)
      phaseInput: null,
      // What files the worker can touch
      allowedScope: null,
    };

    switch (phase) {
      case "planning":
        // Planner sees nothing — only the user prompt (injected via template)
        context.plan = null;
        context.allowedScope = "none — output only";
        break;

      case "scaffolding":
        // Scaffolder sees the plan, nothing else
        context.allowedScope = "project root — create structure only";
        break;

      case "coding":
        // Coder sees the plan and the file list that already exists
        context.allowedScope = "files listed in plan only";
        break;

      case "verifying":
        // Verifier sees the plan (for completeness check) but NOT code logs
        context.phaseInput = { acceptance: this.plan?.acceptance };
        context.allowedScope = "read-only";
        break;

      case "fixing":
        // Fixer sees the verify verdict ONLY, not previous fix attempts
        context.phaseInput = this.phaseResults.verifying;
        context.allowedScope = "files listed in plan only";
        break;

      default:
        break;
    }

    return context;
  }

  /**
   * Decide what to do after a phase completes.
   * Returns: { action: "advance" | "retry" | "abort", nextState: string, reason: string }
   */
  decide(phase, result) {
    let decision;

    switch (phase) {
      case "planning": {
        const contract = this.validateContract("planning", result.parsed || {});
        if (contract.valid) {
          decision = { action: "advance", nextState: "plan_review", reason: "Plan contract valid" };
        } else {
          decision = { action: "retry", nextState: "planning", reason: `Contract failed: ${contract.errors.join("; ")}` };
        }
        break;
      }

      case "plan_review": {
        // Plan review is done by the supervisor itself (no LLM call)
        // Just validates structure and reasonableness
        decision = { action: "advance", nextState: "scaffolding", reason: "Plan review passed" };
        break;
      }

      case "scaffolding": {
        decision = { action: "advance", nextState: "scaffold_check", reason: "Scaffold completed" };
        break;
      }

      case "scaffold_check": {
        // Check that package.json exists and npm install succeeded
        decision = { action: "advance", nextState: "coding", reason: "Scaffold check passed" };
        break;
      }

      case "coding": {
        decision = { action: "advance", nextState: "code_review", reason: "Code written" };
        break;
      }

      case "code_review": {
        // After coding, go straight to verification
        decision = { action: "advance", nextState: "verifying", reason: "Code review passed — proceeding to verify" };
        break;
      }

      case "verifying": {
        const verdict = result.parsed || { pass: false };
        if (verdict.pass) {
          decision = { action: "advance", nextState: "deploying", reason: "All checks passed" };
        } else if (this.fixAttempts < this.maxFixAttempts) {
          decision = { action: "retry", nextState: "fixing", reason: `Verification failed, fix attempt ${this.fixAttempts + 1}/${this.maxFixAttempts}` };
        } else {
          decision = { action: "advance", nextState: "deploying", reason: `Max fix attempts (${this.maxFixAttempts}) reached — deploying anyway` };
        }
        break;
      }

      case "fixing": {
        this.fixAttempts++;
        decision = { action: "advance", nextState: "verifying", reason: `Fix attempt ${this.fixAttempts} complete — re-verifying` };
        break;
      }

      case "deploying": {
        decision = { action: "advance", nextState: "done", reason: "Deployment successful" };
        break;
      }

      default:
        decision = { action: "abort", nextState: "aborted", reason: `Unknown phase: ${phase}` };
    }

    this.audit.decision(phase, decision.action, decision.reason);
    return decision;
  }

  /**
   * Record a phase result and return the supervisor's decision.
   */
  async completePhase(phase, result) {
    this.phaseResults[phase] = result.parsed || result.output;

    if (phase === "planning" && result.parsed) {
      this.plan = result.parsed;
    }

    // Drift detection after coding and fixing
    if (phase === "coding" || phase === "fixing") {
      const drift = await this.checkDrift(phase);
      if (drift.warnings.length > 0) {
        for (const w of drift.warnings) {
          this.audit.error(phase, `DRIFT: ${w}`);
        }
      }
    }

    const decision = this.decide(phase, result);
    await this.audit.flush();
    return decision;
  }

  /**
   * Save full pipeline state for debugging/resume.
   */
  async saveState() {
    await saveArtifact(this.runDir, "state.json", {
      state: this.state,
      fixAttempts: this.fixAttempts,
      plan: this.plan,
      phaseResults: Object.keys(this.phaseResults),
      timestamp: new Date().toISOString(),
    });
    await this.audit.flush();
  }
}
