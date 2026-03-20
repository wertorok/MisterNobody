# Codex CLI Skill

## Description

Use OpenAI Codex CLI directly from Claude Code to run AI-powered coding tasks via the `codex` command-line tool.

## Installation

```bash
npm install -g @openai/codex
```

Set your API key:

```bash
export OPENAI_API_KEY=your_key_here
```

## Usage

Invoke with `/codex [task]` or ask Claude to run a Codex CLI command.

## Commands

```bash
# Run a coding task
codex "refactor this function to use async/await"

# Interactive mode
codex

# Run with a specific model
codex --model o4-mini "write unit tests for src/utils.ts"

# Full auto mode (no confirmations)
codex --approval-mode full-auto "fix all lint errors"
```

## Features

- Autonomous code editing with sandboxed execution
- Multi-file context awareness
- Git-aware: reads repository structure
- Supports `--approval-mode` for automation levels: `suggest`, `auto-edit`, `full-auto`
- Works with any OpenAI-compatible model

## Notes

- Requires `OPENAI_API_KEY` environment variable
- Runs in the current working directory
- All changes are applied to local files; review before committing
