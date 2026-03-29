#!/usr/bin/env node

/**
 * Prompt-to-Deploy Pipeline Orchestrator
 *
 * Usage:
 *   node pipeline/orchestrator.mjs "Build a landing page for food delivery"
 *   node pipeline/orchestrator.mjs --framework next "E-commerce site"
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { runClaude, loadPrompt, saveArtifact, loadArtifact } from "./lib/claude.mjs";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MAX_FIX_ATTEMPTS = 3;
const PLAN_MODEL = "claude-opus-4-6";
const WORK_MODEL = "claude-sonnet-4-6";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(phase, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${phase.toUpperCase().padEnd(8)}] ${msg}`);
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
// Phases
// ---------------------------------------------------------------------------

async function phasePlan(runDir, projectDir, opts) {
  log("plan", "Generating project plan...");

  const prompt = await loadPrompt("plan", {
    USER_PROMPT: opts.prompt,
    FRAMEWORK_HINT: opts.framework ? `Use ${opts.framework} framework.` : "Choose the best framework for the task.",
    PROJECT_DIR: projectDir,
  });

  const result = await runClaude({
    prompt,
    cwd: projectDir,
    model: PLAN_MODEL,
    maxTurns: 5,
    json: true,
    timeoutMs: 5 * 60 * 1000,
  });

  if (!result.parsed) {
    // Try to extract plan from raw output
    throw new Error("PLAN phase failed to produce structured output:\n" + result.output.slice(0, 500));
  }

  await saveArtifact(runDir, "plan.json", result.parsed);
  log("plan", `Plan ready: ${result.parsed.framework || "unknown"} / ${(result.parsed.files || []).length} files planned`);
  return result.parsed;
}

async function phaseScaffold(runDir, projectDir, plan) {
  log("scaffold", "Scaffolding project structure...");

  const prompt = await loadPrompt("scaffold", {
    PLAN_JSON: JSON.stringify(plan, null, 2),
    PROJECT_DIR: projectDir,
  });

  const result = await runClaude({
    prompt,
    cwd: projectDir,
    model: WORK_MODEL,
    allowedTools: ["Bash", "Write", "Read"],
    maxTurns: 30,
    timeoutMs: 5 * 60 * 1000,
  });

  await saveArtifact(runDir, "scaffold.log", result.output);
  log("scaffold", "Project scaffolded");
}

async function phaseCode(runDir, projectDir, plan) {
  log("code", "Writing application code...");

  const prompt = await loadPrompt("code", {
    PLAN_JSON: JSON.stringify(plan, null, 2),
    PROJECT_DIR: projectDir,
  });

  const result = await runClaude({
    prompt,
    cwd: projectDir,
    model: WORK_MODEL,
    allowedTools: ["Bash", "Write", "Edit", "Read", "Glob", "Grep"],
    maxTurns: 80,
    timeoutMs: 15 * 60 * 1000,
  });

  await saveArtifact(runDir, "code.log", result.output);
  log("code", "Code written");
}

async function phaseVerify(runDir, projectDir) {
  log("verify", "Verifying build and quality...");

  const prompt = await loadPrompt("verify", {
    PROJECT_DIR: projectDir,
  });

  const result = await runClaude({
    prompt,
    cwd: projectDir,
    model: WORK_MODEL,
    allowedTools: ["Bash", "Read", "Glob", "Grep"],
    maxTurns: 20,
    json: true,
    timeoutMs: 5 * 60 * 1000,
  });

  const verdict = result.parsed || { pass: false, issues: [result.output.slice(0, 500)] };
  await saveArtifact(runDir, "verify.json", verdict);

  log("verify", verdict.pass ? "PASS" : `FAIL (${(verdict.issues || []).length} issues)`);
  return verdict;
}

async function phaseFix(runDir, projectDir, verdict, attempt) {
  log("fix", `Fixing issues (attempt ${attempt}/${MAX_FIX_ATTEMPTS})...`);

  const prompt = await loadPrompt("fix", {
    PROJECT_DIR: projectDir,
    VERDICT_JSON: JSON.stringify(verdict, null, 2),
    ATTEMPT: String(attempt),
  });

  const result = await runClaude({
    prompt,
    cwd: projectDir,
    model: WORK_MODEL,
    allowedTools: ["Bash", "Write", "Edit", "Read", "Glob", "Grep"],
    maxTurns: 40,
    timeoutMs: 10 * 60 * 1000,
  });

  await saveArtifact(runDir, `fix-${attempt}.log`, result.output);
  log("fix", `Fix attempt ${attempt} complete`);
}

async function phaseDeploy(runDir, projectDir, deployTarget) {
  log("deploy", `Deploying to ${deployTarget}...`);

  let url;

  if (deployTarget === "vercel") {
    try {
      const output = execSync("npx vercel --yes --prod 2>&1", {
        cwd: projectDir,
        encoding: "utf-8",
        timeout: 5 * 60 * 1000,
        env: { ...process.env },
      });

      // Vercel outputs the URL as the last line
      const lines = output.trim().split("\n");
      url = lines.find((l) => l.startsWith("https://")) || lines[lines.length - 1];
    } catch (err) {
      throw new Error(`Deploy failed: ${err.stderr || err.message}`);
    }
  } else if (deployTarget === "netlify") {
    try {
      // Build first if dist/build/out exists
      try {
        execSync("npm run build", { cwd: projectDir, encoding: "utf-8", timeout: 3 * 60 * 1000 });
      } catch { /* build might already be done */ }

      const output = execSync("npx netlify deploy --prod --dir=dist 2>&1", {
        cwd: projectDir,
        encoding: "utf-8",
        timeout: 5 * 60 * 1000,
      });

      const urlMatch = output.match(/https:\/\/[^\s]+\.netlify\.app/);
      url = urlMatch ? urlMatch[0] : output.trim().split("\n").pop();
    } catch (err) {
      throw new Error(`Deploy failed: ${err.stderr || err.message}`);
    }
  } else {
    throw new Error(`Unknown deploy target: ${deployTarget}`);
  }

  await saveArtifact(runDir, "deploy.json", { url, deployTarget, deployedAt: new Date().toISOString() });
  log("deploy", `Deployed: ${url}`);
  return url;
}

// ---------------------------------------------------------------------------
// Main Pipeline
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = resolve(`./runs/${timestamp}`);
  const projectDir = join(runDir, "project");

  await mkdir(projectDir, { recursive: true });
  await saveArtifact(runDir, "input.json", { prompt: opts.prompt, framework: opts.framework, deploy: opts.deploy, startedAt: new Date().toISOString() });

  log("main", `Pipeline started`);
  log("main", `Prompt: "${opts.prompt}"`);
  log("main", `Run dir: ${runDir}`);

  try {
    // Phase 1: Plan
    const plan = await phasePlan(runDir, projectDir, opts);

    // Phase 2: Scaffold
    await phaseScaffold(runDir, projectDir, plan);

    // Phase 3: Code
    await phaseCode(runDir, projectDir, plan);

    // Phase 4+5: Verify → Fix loop
    let verdict;
    for (let attempt = 0; attempt <= MAX_FIX_ATTEMPTS; attempt++) {
      verdict = await phaseVerify(runDir, projectDir);

      if (verdict.pass) break;

      if (attempt < MAX_FIX_ATTEMPTS) {
        await phaseFix(runDir, projectDir, verdict, attempt + 1);
      } else {
        log("main", `WARNING: Build still failing after ${MAX_FIX_ATTEMPTS} fix attempts. Deploying anyway.`);
      }
    }

    // Phase 6: Deploy
    const url = await phaseDeploy(runDir, projectDir, opts.deploy);

    // Final report
    const report = {
      status: "success",
      url,
      prompt: opts.prompt,
      framework: plan.framework,
      filesCreated: plan.files?.length || "unknown",
      fixAttempts: verdict?.pass ? 0 : MAX_FIX_ATTEMPTS,
      runDir,
      completedAt: new Date().toISOString(),
    };

    await saveArtifact(runDir, "report.json", report);

    log("main", "");
    log("main", "========================================");
    log("main", `  DONE: ${url}`);
    log("main", "========================================");
    log("main", "");

    console.log(url);
  } catch (err) {
    log("main", `FATAL: ${err.message}`);
    await saveArtifact(runDir, "error.json", { error: err.message, stack: err.stack, failedAt: new Date().toISOString() });
    process.exit(1);
  }
}

main();
