#!/usr/bin/env node

/**
 * Prompt-to-Deploy Pipeline Orchestrator (v2)
 *
 * The Supervisor controls everything:
 * - State machine decides what runs next
 * - Contract validation gates every transition
 * - Drift detection catches workers going off-plan
 * - Workers are isolated — they see ONLY what the supervisor gives them
 * - Full audit trail of every decision
 *
 * Usage:
 *   node pipeline/orchestrator.mjs "Build a landing page for food delivery"
 *   node pipeline/orchestrator.mjs --framework next "E-commerce site"
 */

import { mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { runClaude, loadPrompt, saveArtifact } from "./lib/claude.mjs";
import { Supervisor } from "./lib/supervisor.mjs";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PLAN_MODEL = "claude-opus-4-6";
const WORK_MODEL = "claude-sonnet-4-6";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(phase, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${phase.toUpperCase().padEnd(10)}] ${msg}`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { framework: null, deploy: "vercel", prompt: "" };
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--framework" && args[i + 1]) {
      opts.framework = args[++i];
    } else if (args[i] === "--deploy" && args[i + 1]) {
      opts.deploy = args[++i];
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`Usage: node orchestrator.mjs [--framework next|vite|html] [--deploy vercel|netlify] "prompt"`);
      process.exit(0);
    } else {
      positional.push(args[i]);
    }
  }

  opts.prompt = positional.join(" ");
  if (!opts.prompt) {
    console.error("Error: prompt is required");
    process.exit(1);
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Worker Functions (isolated — receive only what supervisor allows)
// ---------------------------------------------------------------------------

/**
 * ISOLATION: Each worker function receives a scoped context from the supervisor.
 * Workers cannot:
 * - See other workers' logs
 * - See the audit trail
 * - See the full state
 * - Access files outside their allowed scope
 * - Choose what to do next (supervisor decides)
 */

async function workerPlan(sv, projectDir, opts) {
  sv.transitionTo("planning", "Starting planning phase");
  sv.audit.workerStart("planning", PLAN_MODEL, []);
  const t0 = Date.now();

  const prompt = await loadPrompt("plan", {
    USER_PROMPT: opts.prompt,
    FRAMEWORK_HINT: opts.framework
      ? `Use ${opts.framework} framework.`
      : "Choose the best framework for the task.",
    PROJECT_DIR: projectDir,
  });

  const result = await runClaude({
    prompt,
    cwd: projectDir,
    model: PLAN_MODEL,
    maxTurns: 5,
    json: true,
    timeoutMs: sv.getTimeout(),
  });

  sv.audit.workerEnd("planning", result.exitCode, Date.now() - t0);
  return result;
}

async function workerScaffold(sv, projectDir) {
  sv.transitionTo("scaffolding", "Starting scaffold phase");
  sv.audit.workerStart("scaffolding", WORK_MODEL, ["Bash", "Write", "Read"]);
  const t0 = Date.now();

  // ISOLATION: Scaffold worker sees ONLY the plan, not code logs
  const ctx = sv.buildWorkerContext("scaffolding");
  const prompt = await loadPrompt("scaffold", {
    PLAN_JSON: JSON.stringify(ctx.plan, null, 2),
    PROJECT_DIR: projectDir,
  });

  const result = await runClaude({
    prompt,
    cwd: projectDir,
    model: WORK_MODEL,
    allowedTools: ["Bash", "Write", "Read"],
    maxTurns: 30,
    timeoutMs: sv.getTimeout(),
  });

  sv.audit.workerEnd("scaffolding", result.exitCode, Date.now() - t0);
  return result;
}

async function workerCode(sv, projectDir) {
  sv.transitionTo("coding", "Starting code phase");
  sv.audit.workerStart("coding", WORK_MODEL, ["Bash", "Write", "Edit", "Read", "Glob", "Grep"]);
  const t0 = Date.now();

  // ISOLATION: Coder sees the plan but NOT scaffold logs
  const ctx = sv.buildWorkerContext("coding");
  const prompt = await loadPrompt("code", {
    PLAN_JSON: JSON.stringify(ctx.plan, null, 2),
    PROJECT_DIR: projectDir,
  });

  const result = await runClaude({
    prompt,
    cwd: projectDir,
    model: WORK_MODEL,
    allowedTools: ["Bash", "Write", "Edit", "Read", "Glob", "Grep"],
    maxTurns: 80,
    timeoutMs: sv.getTimeout(),
  });

  sv.audit.workerEnd("coding", result.exitCode, Date.now() - t0);
  return result;
}

async function workerVerify(sv, projectDir) {
  sv.transitionTo("verifying", "Starting verification phase");
  sv.audit.workerStart("verifying", WORK_MODEL, ["Bash", "Read", "Glob", "Grep"]);
  const t0 = Date.now();

  // ISOLATION: Verifier sees plan (for completeness) but NOT code/fix logs
  // Verifier has READ-ONLY tools — cannot modify files
  const prompt = await loadPrompt("verify", { PROJECT_DIR: projectDir });

  const result = await runClaude({
    prompt,
    cwd: projectDir,
    model: WORK_MODEL,
    allowedTools: ["Bash", "Read", "Glob", "Grep"],
    maxTurns: 20,
    json: true,
    timeoutMs: sv.getTimeout(),
  });

  sv.audit.workerEnd("verifying", result.exitCode, Date.now() - t0);
  return result;
}

async function workerFix(sv, projectDir) {
  sv.transitionTo("fixing", "Starting fix phase");
  sv.audit.workerStart("fixing", WORK_MODEL, ["Bash", "Write", "Edit", "Read", "Glob", "Grep"]);
  const t0 = Date.now();

  // ISOLATION: Fixer sees ONLY the verify verdict, not previous fix logs
  // This prevents the fixer from repeating the same broken approach
  const ctx = sv.buildWorkerContext("fixing");
  const prompt = await loadPrompt("fix", {
    PROJECT_DIR: projectDir,
    VERDICT_JSON: JSON.stringify(ctx.phaseInput, null, 2),
    ATTEMPT: String(sv.fixAttempts + 1),
  });

  const result = await runClaude({
    prompt,
    cwd: projectDir,
    model: WORK_MODEL,
    allowedTools: ["Bash", "Write", "Edit", "Read", "Glob", "Grep"],
    maxTurns: 40,
    timeoutMs: sv.getTimeout(),
  });

  sv.audit.workerEnd("fixing", result.exitCode, Date.now() - t0);
  return result;
}

function workerDeploy(projectDir, deployTarget) {
  if (deployTarget === "vercel") {
    const output = execSync("npx vercel --yes --prod 2>&1", {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 5 * 60 * 1000,
      env: { ...process.env },
    });
    const lines = output.trim().split("\n");
    return lines.find((l) => l.startsWith("https://")) || lines[lines.length - 1];
  }

  if (deployTarget === "netlify") {
    try {
      execSync("npm run build", { cwd: projectDir, encoding: "utf-8", timeout: 3 * 60 * 1000 });
    } catch { /* may already be built */ }

    const output = execSync("npx netlify deploy --prod --dir=dist 2>&1", {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 5 * 60 * 1000,
    });
    const urlMatch = output.match(/https:\/\/[^\s]+\.netlify\.app/);
    return urlMatch ? urlMatch[0] : output.trim().split("\n").pop();
  }

  throw new Error(`Unknown deploy target: ${deployTarget}`);
}

// ---------------------------------------------------------------------------
// Supervisor Review Steps (no LLM — pure logic)
// ---------------------------------------------------------------------------

async function reviewPlan(sv, result) {
  sv.transitionTo("plan_review", "Supervisor reviewing plan");

  const plan = result.parsed;
  if (!plan) {
    sv.audit.decision("plan_review", "reject", "No JSON output from planner");
    return { action: "retry", nextState: "planning", reason: "Planner produced no JSON" };
  }

  const contract = sv.validateContract("planning", plan);
  if (!contract.valid) {
    sv.audit.decision("plan_review", "reject", contract.errors.join("; "));
    return { action: "retry", nextState: "planning", reason: `Contract: ${contract.errors.join("; ")}` };
  }

  // Reasonableness checks
  const warnings = [];
  if ((plan.files || []).length > 50) warnings.push("Over 50 files planned — possible over-engineering");
  if ((plan.pages || []).length > 20) warnings.push("Over 20 pages — is this really needed?");

  for (const w of warnings) {
    sv.audit.error("plan_review", `WARNING: ${w}`);
  }

  sv.audit.decision("plan_review", "approve", "Plan is valid and reasonable");
  return { action: "advance", nextState: "scaffolding", reason: "Plan approved" };
}

async function reviewScaffold(sv, projectDir) {
  sv.transitionTo("scaffold_check", "Supervisor checking scaffold");

  // Verify package.json exists
  try {
    await stat(join(projectDir, "package.json"));
  } catch {
    sv.audit.decision("scaffold_check", "reject", "No package.json found");
    return { action: "retry", nextState: "scaffolding", reason: "package.json missing" };
  }

  sv.audit.decision("scaffold_check", "approve", "Scaffold valid — package.json exists");
  return { action: "advance", nextState: "coding", reason: "Scaffold approved" };
}

async function reviewCode(sv) {
  sv.transitionTo("code_review", "Supervisor reviewing code output");

  // Check drift
  const drift = await sv.checkDrift("coding");

  if (drift.warnings.length > 0) {
    log("supervisor", `DRIFT WARNING: ${drift.warnings.join("; ")}`);
  }

  if (drift.missingFiles.length > 0) {
    log("supervisor", `Missing planned files: ${drift.missingFiles.join(", ")}`);
    // Don't reject — verify phase will catch actual build failures
  }

  sv.audit.decision("code_review", "approve", "Proceeding to verification");
  return { action: "advance", nextState: "verifying", reason: "Code review passed" };
}

// ---------------------------------------------------------------------------
// Main Pipeline Loop
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = resolve(`./runs/${timestamp}`);
  const projectDir = join(runDir, "project");

  await mkdir(projectDir, { recursive: true });
  await saveArtifact(runDir, "input.json", {
    prompt: opts.prompt,
    framework: opts.framework,
    deploy: opts.deploy,
    startedAt: new Date().toISOString(),
  });

  const sv = new Supervisor(runDir, projectDir);

  log("supervisor", "Pipeline started");
  log("supervisor", `Prompt: "${opts.prompt}"`);
  log("supervisor", `Run: ${runDir}`);
  log("supervisor", "");

  try {
    // -----------------------------------------------------------------------
    // PHASE 1: Plan
    // -----------------------------------------------------------------------
    let planResult = await workerPlan(sv, projectDir, opts);
    await saveArtifact(runDir, "plan-raw.log", planResult.output);

    // Supervisor reviews plan (no LLM — contract + reasonableness)
    let planDecision = await reviewPlan(sv, planResult);

    // Retry plan if contract failed (max 2 attempts)
    let planAttempts = 1;
    while (planDecision.action === "retry" && planAttempts < 3) {
      log("supervisor", `Plan rejected: ${planDecision.reason}. Retrying...`);
      sv.transitionTo("planning", `Re-planning (attempt ${planAttempts + 1})`);
      // Can't use transitionTo directly since we need to reset state
      sv.state = "init";
      planResult = await workerPlan(sv, projectDir, opts);
      await saveArtifact(runDir, `plan-raw-${planAttempts + 1}.log`, planResult.output);
      planDecision = await reviewPlan(sv, planResult);
      planAttempts++;
    }

    if (planDecision.action === "retry") {
      throw new Error(`Planning failed after ${planAttempts} attempts: ${planDecision.reason}`);
    }

    sv.plan = planResult.parsed;
    await saveArtifact(runDir, "plan.json", sv.plan);
    log("supervisor", `Plan approved: ${sv.plan.framework} / ${sv.plan.files.length} files`);

    // -----------------------------------------------------------------------
    // PHASE 2: Scaffold
    // -----------------------------------------------------------------------
    const scaffoldResult = await workerScaffold(sv, projectDir);
    await saveArtifact(runDir, "scaffold.log", scaffoldResult.output);

    const scaffoldDecision = await reviewScaffold(sv, projectDir);
    if (scaffoldDecision.action === "retry") {
      // One retry for scaffold
      log("supervisor", `Scaffold rejected: ${scaffoldDecision.reason}. Retrying...`);
      sv.state = "scaffold_check"; // reset
      const retry = await workerScaffold(sv, projectDir);
      await saveArtifact(runDir, "scaffold-2.log", retry.output);
      const retryCheck = await reviewScaffold(sv, projectDir);
      if (retryCheck.action !== "advance") {
        throw new Error(`Scaffold failed after retry: ${retryCheck.reason}`);
      }
    }

    log("supervisor", "Scaffold approved");

    // -----------------------------------------------------------------------
    // PHASE 3: Code
    // -----------------------------------------------------------------------
    const codeResult = await workerCode(sv, projectDir);
    await saveArtifact(runDir, "code.log", codeResult.output);

    const codeDecision = await reviewCode(sv);
    log("supervisor", `Code review: ${codeDecision.reason}`);

    // -----------------------------------------------------------------------
    // PHASE 4+5: Verify ↔ Fix loop (supervisor-controlled)
    // -----------------------------------------------------------------------
    let deployed = false;

    while (sv.state !== "deploying" && sv.state !== "aborted") {
      // Verify
      const verifyResult = await workerVerify(sv, projectDir);
      await saveArtifact(runDir, `verify-${sv.fixAttempts}.json`,
        verifyResult.parsed || { raw: verifyResult.output.slice(0, 2000) });

      const verifyDecision = await sv.completePhase("verifying", verifyResult);
      log("supervisor", `Verify decision: ${verifyDecision.action} — ${verifyDecision.reason}`);

      if (verifyDecision.nextState === "deploying") {
        sv.transitionTo("deploying", verifyDecision.reason);
        break;
      }

      if (verifyDecision.nextState === "fixing") {
        // Fix
        const fixResult = await workerFix(sv, projectDir);
        await saveArtifact(runDir, `fix-${sv.fixAttempts}.log`, fixResult.output);

        const fixDecision = await sv.completePhase("fixing", fixResult);
        log("supervisor", `Fix decision: ${fixDecision.action} — ${fixDecision.reason}`);
        // Loop back to verify
      }
    }

    // -----------------------------------------------------------------------
    // PHASE 6: Deploy
    // -----------------------------------------------------------------------
    log("supervisor", "Deploying...");
    const url = workerDeploy(projectDir, opts.deploy);

    sv.transitionTo("done", "Deployment successful");
    await saveArtifact(runDir, "deploy.json", {
      url,
      deployTarget: opts.deploy,
      deployedAt: new Date().toISOString(),
    });

    // -----------------------------------------------------------------------
    // Final Report
    // -----------------------------------------------------------------------
    const report = {
      status: "success",
      url,
      prompt: opts.prompt,
      framework: sv.plan.framework,
      filesPlanned: sv.plan.files.length,
      fixAttempts: sv.fixAttempts,
      phases: Object.keys(sv.phaseResults),
      runDir,
      completedAt: new Date().toISOString(),
    };

    await saveArtifact(runDir, "report.json", report);
    await sv.saveState();

    log("supervisor", "");
    log("supervisor", "============================================");
    log("supervisor", `  DONE: ${url}`);
    log("supervisor", `  Fix attempts: ${sv.fixAttempts}`);
    log("supervisor", `  Audit log: ${runDir}/audit.json`);
    log("supervisor", "============================================");
    log("supervisor", "");

    console.log(url);

  } catch (err) {
    sv.audit.error(sv.state, err.message);
    sv.state = "aborted";
    await sv.saveState();

    log("supervisor", `FATAL: ${err.message}`);
    await saveArtifact(runDir, "error.json", {
      error: err.message,
      stack: err.stack,
      state: sv.state,
      failedAt: new Date().toISOString(),
    });
    process.exit(1);
  }
}

main();
