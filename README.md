# MisterNobody

Prompt-to-deploy pipeline. Give it a prompt, get back a live website URL.

## Quick Start

```bash
./pipeline/run.sh "Landing page for food delivery with cart and order form"
```

## What Happens

1. **PLAN** (opus) — generates project architecture as JSON
2. **SCAFFOLD** (sonnet) — creates project skeleton via framework CLI
3. **CODE** (sonnet) — writes all pages, components, styles
4. **VERIFY** (sonnet) — runs build, lint, typecheck
5. **FIX** (sonnet) — auto-fixes any issues (up to 3 attempts)
6. **DEPLOY** (vercel) — ships to production, returns URL

Zero human intervention between prompt and URL.

## Requirements

- Node.js 20+
- Claude Code CLI (`claude`)
- Vercel CLI (installed automatically via npx)
- `ANTHROPIC_API_KEY` set

## Options

```bash
# Choose framework
./pipeline/run.sh --framework next "E-commerce site"

# Deploy to Netlify instead
./pipeline/run.sh --deploy netlify "Portfolio site"
```

## Cost

~$0.30 per site (one opus call for planning, rest on sonnet).

## Run Artifacts

Each run creates `runs/<timestamp>/` with:
- `input.json` — your prompt
- `plan.json` — project plan
- `verify.json` — build/lint/type results
- `report.json` — final status + URL
- `project/` — the actual source code
