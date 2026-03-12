# Antigravity Skill

Installed from: https://antigravity.google/download

Location: `/usr/bin/antigravity` (installed via APT repository)

## Description

Google Antigravity is an AI-first agentic development platform launched in November 2025 alongside Gemini 3. Built on a VS Code fork, it replaces the standard file explorer with a Mission Control interface for managing autonomous agents that can plan, code, and browse the web.

## Installation

Installed on Ubuntu 24.04 via the official Google APT repository:

```bash
mkdir -p /etc/apt/keyrings
curl -fsSL https://us-central1-apt.pkg.dev/doc/repo-signing-key.gpg | gpg --batch --no-tty --dearmor > /etc/apt/keyrings/antigravity-repo-key.gpg
echo "deb [signed-by=/etc/apt/keyrings/antigravity-repo-key.gpg] https://us-central1-apt.pkg.dev/projects/antigravity-auto-updater-dev/ antigravity-debian main" > /etc/apt/sources.list.d/antigravity.list
apt update && apt install -y antigravity
```

Version: `1.20.5-1772853402`

## Features

- Agent Manager Dashboard for orchestrating multiple autonomous agents
- VS Code-based editor with full extension compatibility
- Multi-model support (Gemini 3, Claude, GPT)
- Browser integration via Chrome extension
- Artifacts system for tracking agent outputs
- Native Google Cloud (Cloud Run, Firebase) integrations
