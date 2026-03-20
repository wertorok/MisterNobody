# Gemini CLI Skill

## Description

Use Google Gemini CLI directly from Claude Code to run AI-powered tasks via the `gemini` command-line tool.

## Installation

```bash
npm install -g @google/gemini-cli
```

Authenticate:

```bash
gemini auth login
```

Or set your API key:

```bash
export GEMINI_API_KEY=your_key_here
```

## Usage

Invoke with `/gemini [task]` or ask Claude to run a Gemini CLI command.

## Commands

```bash
# Ask a question or run a task
gemini "explain this codebase"

# Interactive REPL
gemini

# Use a specific model
gemini --model gemini-2.5-pro "review this PR diff"

# Run a non-interactive prompt
gemini -p "summarize the changes in the last 5 commits"
```

## Features

- 1M token context window — can ingest entire codebases
- Built-in tools: file read/write, web search, shell execution
- Google Search grounding for up-to-date information
- Supports multimodal input (images, PDFs)
- Free tier available with a Google account

## Notes

- Requires Google account login (`gemini auth login`) or `GEMINI_API_KEY`
- Runs in the current working directory
- Use `--sandbox` flag to restrict file system access
