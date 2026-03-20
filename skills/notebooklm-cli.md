# NotebookLM CLI Skill

## Description

Use NotebookLM directly from Claude Code via the `notebooklm` CLI — query your notebooks, upload sources, and get source-grounded answers without leaving the terminal.

## Installation

```bash
npm install -g notebooklm-cli
```

Authenticate with your Google account:

```bash
notebooklm auth login
```

## Usage

Invoke with `/notebooklm [command]` or ask Claude to run a NotebookLM command.

## Commands

```bash
# List all notebooks
notebooklm list

# Create a new notebook
notebooklm create "My Project Notes"

# Query a notebook
notebooklm query <notebook-id> "what are the main findings?"

# Add a source (URL, file, or text)
notebooklm add-source <notebook-id> https://example.com/paper.pdf
notebooklm add-source <notebook-id> ./report.md
notebooklm add-source <notebook-id> --text "Paste content here"

# List sources in a notebook
notebooklm sources <notebook-id>

# Remove a source
notebooklm remove-source <notebook-id> <source-id>

# Generate audio overview (podcast)
notebooklm audio <notebook-id>

# Export notebook notes
notebooklm export <notebook-id> --output notes.md

# Delete a notebook
notebooklm delete <notebook-id>
```

## Features

- Source-grounded answers — responses cite only uploaded documents
- Supports PDFs, Google Docs, web URLs, YouTube videos, plain text
- Generates audio overviews (AI podcast) from sources
- Zero hallucinations outside of source material
- Powered by Gemini with deep document understanding

## Notes

- Requires a Google account (`notebooklm auth login`)
- NotebookLM is free with a Google account
- Answers are strictly grounded in uploaded sources — not general knowledge
- For browser-based automation see the `/notebooklm` skill (installed separately)
