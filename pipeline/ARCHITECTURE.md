# Prompt-to-Deploy Pipeline — Architecture v2

## What This Is

```
You: "Сделай лендинг для доставки еды с корзиной и формой заказа"
      ↓
Pipeline: [SUPERVISOR controls everything]
      ↓
You: https://your-site-abc123.vercel.app
```

---

## Who Controls What

### The Supervisor (`lib/supervisor.mjs`)

The supervisor is the **only entity that sees everything**. It is NOT an LLM — it's deterministic code.

```
┌──────────────────────────────────────────────────────────────┐
│                      SUPERVISOR                              │
│                                                              │
│  Owns:                                                       │
│  ├── State machine (what phase runs next)                    │
│  ├── Contract validation (did the worker return valid JSON?) │
│  ├── Drift detection (did the worker go off-plan?)           │
│  ├── Retry policy (how many attempts per phase)              │
│  ├── Worker isolation (what each worker can see)             │
│  ├── Audit log (every decision, every transition)            │
│  └── Abort logic (when to give up)                           │
│                                                              │
│  Does NOT:                                                   │
│  ├── Write code                                              │
│  ├── Make creative decisions                                 │
│  ├── Call LLMs for its own reasoning                         │
│  └── Trust workers blindly                                   │
└──────────────────────────────────────────────────────────────┘
```

### Workers (Claude Code CLI sessions)

Workers are **disposable, stateless, isolated sessions**. Each worker:
- Starts fresh (no memory of previous workers)
- Sees ONLY what the supervisor gives it
- Returns structured output
- Has no idea what happens next
- Cannot communicate with other workers

---

## State Machine

```
                    ┌──── reject ────┐
                    ▼                │
  init → PLANNING → PLAN_REVIEW ────┘
                        │
                      approve
                        │
                    ┌───▼───┐
                    │SCAFFOLD│
                    └───┬───┘
                        │
                  SCAFFOLD_CHECK
                    │        │
                  pass    reject → retry SCAFFOLD
                    │
                 ┌──▼──┐
                 │ CODE │
                 └──┬──┘
                    │
               CODE_REVIEW
                    │
              ┌─────▼─────┐    fail     ┌─────┐
              │  VERIFY    │────────────▶│ FIX │
              └─────┬──────┘             └──┬──┘
                    │                       │
                  pass              ┌───────┘
                    │               │ (back to VERIFY)
              ┌─────▼─────┐
              │  DEPLOY    │
              └─────┬──────┘
                    │
                  DONE
```

Every transition is **explicit and logged**. Invalid transitions throw errors.

### Transition Rules

```javascript
{
  init:          → [planning]
  planning:      → [plan_review]
  plan_review:   → [scaffolding, planning]       // can reject
  scaffolding:   → [scaffold_check]
  scaffold_check:→ [coding, scaffolding]          // can reject
  coding:        → [code_review]
  code_review:   → [verifying, coding]            // can reject
  verifying:     → [fixing, deploying, aborted]   // fail/pass/give up
  fixing:        → [verifying]                    // always back to verify
  deploying:     → [done, aborted]
}
```

---

## Isolation Policy — Who Sees What

This is the most important design decision. **Workers cannot see each other.**

```
┌───────────────────────────────────────────────────────────────┐
│                    SUPERVISOR (sees everything)                │
│                                                               │
│  ┌─────────┐   ┌──────────┐   ┌──────┐   ┌────────┐         │
│  │ PLANNER │   │SCAFFOLDER│   │CODER │   │VERIFIER│   ...   │
│  │         │   │          │   │      │   │        │         │
│  │ Sees:   │   │ Sees:    │   │Sees: │   │ Sees:  │         │
│  │ - prompt│   │ - plan   │   │- plan│   │ - plan │         │
│  │         │   │          │   │      │   │(accept)│         │
│  │ Cannot: │   │ Cannot:  │   │Can't:│   │        │         │
│  │ - files │   │ - code   │   │- logs│   │ Cannot:│         │
│  │ - logs  │   │   logs   │   │- fix │   │ - code │         │
│  │ - state │   │ - verify │   │  logs│   │   logs │         │
│  │         │   │   results│   │      │   │ - fix  │         │
│  └─────────┘   └──────────┘   └──────┘   │   logs │         │
│                                           └────────┘         │
│                                                               │
│  ┌──────┐                                                     │
│  │FIXER │  Sees: verify verdict ONLY                         │
│  │      │  Cannot: previous fix logs, code logs, plan details│
│  └──────┘                                                     │
└───────────────────────────────────────────────────────────────┘
```

### Why this isolation?

| Problem | What isolation prevents |
|---------|----------------------|
| Coder copies scaffolder's mistakes | Coder never sees scaffold logs |
| Fixer repeats same broken approach | Fixer never sees previous fix logs |
| Verifier is biased by code intent | Verifier doesn't see code logs, only output |
| Worker ignores plan, does own thing | Supervisor detects drift after each phase |
| Worker hallucinates project state | Worker gets fresh context every time |

### What each worker receives

| Worker | Sees | Tools | Can modify files? |
|--------|------|-------|-------------------|
| Planner | User prompt only | None (generation only) | No |
| Scaffolder | plan.json | Bash, Write, Read | Yes (create only) |
| Coder | plan.json | Bash, Write, Edit, Read, Glob, Grep | Yes |
| Verifier | plan.acceptance | Bash, Read, Glob, Grep | **No (read-only)** |
| Fixer | verify verdict | Bash, Write, Edit, Read, Glob, Grep | Yes |

---

## Contract Enforcement

Each phase has a **contract** — a schema that the output must satisfy before the supervisor advances.

### Planning Contract

```javascript
{
  required: ["framework", "description", "pages", "components", "files", "acceptance"],
  validate(output) {
    // - framework must be set
    // - pages array must be non-empty, each with path + purpose
    // - files array must be non-empty
    // - acceptance criteria must be non-empty
  }
}
```

If the planner returns invalid JSON or missing fields → **reject, re-plan**.

### Verify Contract

```javascript
{
  required: ["pass", "build", "issues"],
  validate(output) {
    // - pass must be boolean
    // - build.success must be boolean
  }
}
```

### Supervisor Reviews (no LLM)

Between worker phases, the supervisor does deterministic checks:

| Review | What it checks | Can reject? |
|--------|---------------|-------------|
| Plan Review | Contract valid + reasonableness (files < 50, pages < 20) | Yes → re-plan |
| Scaffold Check | package.json exists | Yes → re-scaffold |
| Code Review | Drift detection (extra/missing files vs plan) | Yes → re-code |

---

## Drift Detection

After the **code** and **fix** phases, the supervisor compares actual files against the plan:

```
Plan says:           Actually created:
  src/app/page.tsx     src/app/page.tsx       ✓ match
  src/app/layout.tsx   src/app/layout.tsx     ✓ match
  src/Header.tsx       src/Header.tsx         ✓ match
                       src/utils/helpers.ts   ⚠ DRIFT: unplanned file
                       src/types/global.d.ts  ⚠ DRIFT: unplanned file
  src/Cart.tsx                                ⚠ MISSING: planned but not created
```

Config files (package.json, tsconfig, etc.) are excluded from drift detection.

If drift exceeds threshold (>10 unplanned files), a warning is logged but the pipeline continues — the verify phase is the real gate.

---

## Audit Trail

Every decision is logged to `audit.json`:

```json
[
  { "timestamp": "...", "type": "transition", "from": "init", "to": "planning", "reason": "Starting planning phase" },
  { "timestamp": "...", "type": "worker_start", "phase": "planning", "model": "claude-opus-4-6", "tools": [] },
  { "timestamp": "...", "type": "worker_end", "phase": "planning", "exitCode": 0, "durationMs": 45000 },
  { "timestamp": "...", "type": "contract_check", "phase": "planning", "passed": true, "errors": [] },
  { "timestamp": "...", "type": "decision", "phase": "plan_review", "decision": "approve", "reason": "Plan is valid and reasonable" },
  { "timestamp": "...", "type": "transition", "from": "plan_review", "to": "scaffolding", "reason": "Plan approved" },
  { "timestamp": "...", "type": "drift_check", "phase": "coding", "extraFiles": ["src/utils/cn.ts"], "missingFiles": [], "warnings": [] },
  { "timestamp": "...", "type": "decision", "phase": "verifying", "decision": "retry", "reason": "Verification failed, fix attempt 1/3" }
]
```

You can reconstruct the full history of every pipeline run from this file.

---

## Communication Hierarchy

```
Human ──prompt──▶ Orchestrator ──delegates──▶ Supervisor
                                                  │
                                    ┌─────────────┼─────────────┐
                                    ▼             ▼             ▼
                              Worker A      Worker B      Worker C
                              (plan)        (code)        (verify)

Communication rules:
  ✓ Human → Orchestrator       (prompt, flags)
  ✓ Orchestrator → Supervisor  (create, start)
  ✓ Supervisor → Worker        (prompt + scoped context)
  ✓ Worker → Supervisor        (structured output)
  ✓ Supervisor → Orchestrator  (decision: advance/retry/abort)
  ✓ Orchestrator → Human       (final URL or error)

  ✗ Worker → Worker            NEVER
  ✗ Worker → Human             NEVER
  ✗ Worker → Supervisor (ask)  NEVER (one-shot, no dialogue)
  ✗ Human → Worker             NEVER (only through supervisor)
```

Workers are **fire-and-forget**:
1. Supervisor sends prompt
2. Worker runs to completion
3. Worker returns output
4. Supervisor evaluates output
5. Supervisor decides next action

No negotiation. No back-and-forth. No "worker asks for clarification."

---

## Run Artifacts

Each run creates `runs/<timestamp>/` with:

```
runs/2026-03-29T14-30-00/
├── input.json            # Original prompt + flags
├── state.json            # Final supervisor state
├── audit.json            # Full decision trail
├── plan.json             # Approved plan
├── plan-raw.log          # Planner's raw output
├── scaffold.log          # Scaffolder's raw output
├── code.log              # Coder's raw output
├── verify-0.json         # First verify result
├── fix-1.log             # First fix attempt (if needed)
├── verify-1.json         # Second verify (if needed)
├── deploy.json           # Deploy result + URL
├── report.json           # Final summary
├── error.json            # Only if pipeline failed
└── project/              # The actual source code
    ├── package.json
    ├── src/
    └── ...
```

---

## Error Handling

| Failure | Supervisor action |
|---------|------------------|
| Planner returns invalid JSON | Retry planning (max 3) |
| Scaffold missing package.json | Retry scaffold (max 2) |
| Code phase timeout | Abort |
| Build fails | Enter fix loop (max 3 attempts) |
| Fix fails to resolve | Deploy anyway (best effort) |
| Deploy fails | Abort with error |
| Any phase throws | Abort, save error.json |

---

## Cost Estimate

| Phase | Model | ~Cost |
|-------|-------|-------|
| Plan (1x) | opus | $0.10 |
| Scaffold (1x) | sonnet | $0.02 |
| Code (1x) | sonnet | $0.12 |
| Verify (1-4x) | sonnet | $0.02-0.08 |
| Fix (0-3x) | sonnet | $0.00-0.15 |
| Deploy | CLI | free |
| **Total** | | **$0.25-0.50** |

---

## Usage

```bash
./pipeline/run.sh "Landing page for food delivery with cart and order form"
./pipeline/run.sh --framework next "E-commerce site for sneakers"
./pipeline/run.sh --deploy netlify "Portfolio site for a photographer"
```
