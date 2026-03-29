/**
 * Claude Code CLI wrapper.
 * Spawns `claude -p` with structured output and scoped tools.
 */

import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Run a Claude Code CLI session.
 *
 * @param {object} opts
 * @param {string} opts.prompt - The prompt text
 * @param {string} opts.cwd - Working directory
 * @param {string} [opts.model] - Model override (e.g. "opus", "sonnet")
 * @param {string[]} [opts.allowedTools] - Tool allowlist
 * @param {number} [opts.maxTurns] - Max agentic turns
 * @param {string} [opts.sessionId] - Resume a session
 * @param {boolean} [opts.json] - Expect JSON output
 * @param {number} [opts.timeoutMs] - Timeout in ms (default: 10 min)
 * @returns {Promise<{output: string, parsed?: object, exitCode: number}>}
 */
export async function runClaude(opts) {
  const {
    prompt,
    cwd,
    model,
    allowedTools,
    maxTurns = 50,
    sessionId,
    json = false,
    timeoutMs = 10 * 60 * 1000,
  } = opts;

  const args = ["-p", prompt, "--output-format", "text", "--max-turns", String(maxTurns)];

  if (model) args.push("--model", model);
  if (sessionId) args.push("--resume", sessionId);
  if (allowedTools?.length) {
    args.push("--allowedTools", allowedTools.join(","));
  }

  return new Promise((resolve, reject) => {
    const proc = spawn("claude", args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      timeout: timeoutMs,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      const output = stdout.trim();
      let parsed;

      if (json) {
        try {
          // Extract JSON from output (Claude may wrap it in markdown)
          const jsonMatch = output.match(/```json\s*([\s\S]*?)```/) ||
                            output.match(/(\{[\s\S]*\})/);
          if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[1].trim());
          }
        } catch {
          // JSON parse failed — return raw output
        }
      }

      if (code !== 0 && !output) {
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
        return;
      }

      resolve({ output, parsed, exitCode: code ?? 0, stderr });
    });

    proc.on("error", reject);
  });
}

/**
 * Load a phase prompt template and fill variables.
 *
 * @param {string} phaseName - e.g. "plan", "code"
 * @param {Record<string, string>} vars - Template variables
 * @returns {Promise<string>}
 */
export async function loadPrompt(phaseName, vars = {}) {
  const phasesDir = join(import.meta.dirname, "..", "phases");
  let template = await readFile(join(phasesDir, `${phaseName}.md`), "utf-8");

  for (const [key, value] of Object.entries(vars)) {
    template = template.replaceAll(`{{${key}}}`, value);
  }

  return template;
}

/**
 * Save a phase artifact (JSON or text).
 */
export async function saveArtifact(runDir, name, data) {
  await mkdir(runDir, { recursive: true });
  const content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  await writeFile(join(runDir, name), content, "utf-8");
}

/**
 * Load a phase artifact.
 */
export async function loadArtifact(runDir, name) {
  const raw = await readFile(join(runDir, name), "utf-8");
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
