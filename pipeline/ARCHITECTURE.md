# Prompt-to-Deploy Pipeline

## What This Is

A linear automation pipeline that takes a text prompt and returns a deployed website URL.
No human intervention between input and output.

```
You: "Сделай лендинг для доставки еды с корзиной и формой заказа"
      ↓
Pipeline: plan → scaffold → code → verify → fix → deploy
      ↓
You: https://your-site-abc123.vercel.app
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│  run.sh "prompt text"                           │
│                                                 │
│  ┌───────────┐    plan.json                     │
│  │  PLAN     │──────────────┐                   │
│  │  (opus)   │              │                   │
│  └───────────┘              ▼                   │
│                      ┌─────────────┐            │
│                      │  SCAFFOLD   │            │
│                      │  (sonnet)   │            │
│                      └──────┬──────┘            │
│                             │                   │
│                      ┌──────▼──────┐            │
│                      │    CODE     │            │
│                      │  (sonnet)   │            │
│                      └──────┬──────┘            │
│                             │                   │
│                      ┌──────▼──────┐  fail      │
│                      │   VERIFY    │────────┐   │
│                      │  (sonnet)   │        │   │
│                      └──────┬──────┘        │   │
│                        pass │         ┌─────▼─┐ │
│                             │         │  FIX  │ │
│                             │         └───┬───┘ │
│                             │             │     │
│                             │    ◄────────┘     │
│                      ┌──────▼──────┐            │
│                      │   DEPLOY    │            │
│                      │  (vercel)   │            │
│                      └──────┬──────┘            │
│                             │                   │
│                        site URL                 │
└─────────────────────────────────────────────────┘
```

## Design Decisions

### Why not Paperclip/OpenClaw?

| Feature | Need it? | Why not |
|---------|----------|---------|
| Org charts | No | No "employees", just pipeline phases |
| Approvals | No | "без меня вообще" = zero human gates |
| Chat channels | No | Input = CLI, Output = URL |
| Budgets | No | Pipeline is finite, not ongoing |
| Heartbeats | No | Push model, not pull |
| Sub-agents | No | Sequential phases, not parallel agents |

### Why Claude Code CLI?

- `claude -p` runs non-interactive with a prompt
- `--output-format json` gives structured output
- `--allowedTools` scopes what each phase can do
- Session persistence via `--resume` for fix loops
- Already installed, zero infrastructure

### Why Vercel?

- `npx vercel --yes` deploys any framework with zero config
- Supports Next.js, Vite, plain HTML, anything
- Returns URL immediately
- Free tier sufficient for generated sites

## Phase Contracts

### Phase 1: PLAN
- **Input:** User prompt (text)
- **Output:** `plan.json` — project spec, framework choice, file list, acceptance criteria
- **Model:** opus (needs reasoning for good architecture)
- **Tools:** None (pure generation)

### Phase 2: SCAFFOLD
- **Input:** `plan.json`
- **Output:** Project directory with package.json, config files, empty structure
- **Model:** sonnet (mechanical work)
- **Tools:** Bash, Write

### Phase 3: CODE
- **Input:** `plan.json` + scaffolded project
- **Output:** All source files written, all components implemented
- **Model:** sonnet (bulk coding)
- **Tools:** Read, Write, Edit, Bash

### Phase 4: VERIFY
- **Input:** Completed project
- **Output:** `verify.json` — build status, lint status, issues list
- **Model:** sonnet
- **Tools:** Read, Bash (npm run build, npm run lint)
- **Max retries:** 3 (loops back to FIX phase)

### Phase 5: FIX (conditional)
- **Input:** `verify.json` + project
- **Output:** Fixed files
- **Model:** sonnet
- **Tools:** Read, Edit, Bash
- **Trigger:** Only if VERIFY fails

### Phase 6: DEPLOY
- **Input:** Built project
- **Output:** Live URL
- **Method:** `npx vercel --yes --prod`
- **No LLM needed** — pure CLI

## File Structure

```
pipeline/
├── run.sh                  # Entry point
├── orchestrator.mjs        # Main pipeline logic
├── lib/
│   └── claude.mjs          # Claude Code CLI wrapper
├── phases/
│   ├── plan.md             # Plan phase prompt
│   ├── scaffold.md         # Scaffold phase prompt
│   ├── code.md             # Code phase prompt
│   ├── verify.md           # Verify phase prompt
│   └── fix.md              # Fix phase prompt
└── ARCHITECTURE.md         # This file
```

## Usage

```bash
# Basic
./pipeline/run.sh "Landing page for food delivery with cart and order form"

# With options
./pipeline/run.sh --framework next "E-commerce site for sneakers"
./pipeline/run.sh --deploy netlify "Portfolio site for a photographer"
```

## Cost Estimate

| Phase | Model | ~Tokens | ~Cost |
|-------|-------|---------|-------|
| Plan | opus | 5K in, 3K out | $0.10 |
| Scaffold | sonnet | 3K in, 2K out | $0.02 |
| Code | sonnet | 10K in, 20K out | $0.12 |
| Verify | sonnet | 5K in, 2K out | $0.02 |
| Fix (if needed) | sonnet | 8K in, 5K out | $0.05 |
| **Total** | | | **~$0.30** |

One site for ~30 cents.
