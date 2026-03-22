# Codex MCP System — Production v4.2

Two MCP servers that allow Claude to fully replace a human as the operator of Codex CLI — reading its reasoning, understanding where it's going, intervening when needed, and granting or denying execution permissions.

**Core principle: Claude wakes up only for real decisions. Everything else is automatic.**

## Architecture

```
CLAUDE
  (wakes up only for NEEDS_CLAUDE / BLOCK_AND_ALERT)
       ↑↓ SummaryPackage = structured fields + reasoning_chunk of current approval cycle
       ↑  raw chunk only as fallback via codex_get_raw_chunk
PERMISSION CACHE
  (remembers what Claude already approved)
       ↑↓
SECURITY GUARD
  (deterministic rules, no models)
       ↑↓ PermissionRequest (structured, not raw)
STREAM PARSER + REQUEST CLASSIFIER
  (stdout+stderr → buffer by \n → stripAnsi per line → PermissionRequest)
       ↑↓
MCP SERVER
  (coordinator, holds child process, buffers approval cycle)
       ↑↓
CODEX CLI
  (executor, untrusted)
```

## Projects

### codex-interactive-mcp

Interactive mode. Claude acts as the Codex operator with full permission management.

**Tools:**
- `codex_start_session` — Start a new interactive Codex session
- `codex_stream_until_permission` — Stream until permission request; returns auto_approved/needs_claude/completed/error
- `codex_respond` — Respond to a permission request (y/n) with optional cache rule
- `codex_get_state` — Get session state and decisions log path
- `codex_get_raw_chunk` — Get full raw output for a cycle (Claude-triggered fallback only)
- `codex_end_session` — End session, kill process tree, save summary

### codex-auto-mcp

Auto mode. Quick tasks with Codex in full-auto mode. Single call → single result.

**Tools:**
- `codex_run` — Run any Codex task in full-auto mode
- `codex_create_file` — Create a specific file
- `codex_refactor` — Refactor a file
- `codex_ask` — Ask a question without modifying files (filesystem integrity verified)
- `codex_check_environment` — Check Codex CLI availability and configuration

## Setup

### Prerequisites

```bash
npm install -g @openai/codex
export OPENAI_API_KEY=sk-...
```

### Build

```bash
# Interactive server
cd codex-interactive-mcp && npm install && npm run build

# Auto server
cd codex-auto-mcp && npm install && npm run build
```

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "codex-interactive": {
      "command": "node",
      "args": ["/path/to/codex-interactive-mcp/dist/index.js"],
      "env": { "OPENAI_API_KEY": "sk-..." }
    },
    "codex-auto": {
      "command": "node",
      "args": ["/path/to/codex-auto-mcp/dist/index.js"],
      "env": { "OPENAI_API_KEY": "sk-..." }
    }
  }
}
```

## Key Design Decisions

### Step 0 Results

`codex exec --json` provides JSONL output — pipe-compatible, no ANSI/TUI.
- `CLI_MODE = 'pipe'` (set in `src/config.ts`)
- Approval mode: `codex exec -a on-request --json`
- Auto mode: `codex exec --full-auto --json`

### Security Layers

1. **Rate limiting** — >20 permission requests in 30s → BLOCK_AND_ALERT
2. **Permission cache** — exact fingerprint + glob matching
3. **Security Guard** — deterministic rules (critical/warning/safe_auto/unknown)
4. **Claude** — final arbiter for NEEDS_CLAUDE and BLOCK_AND_ALERT

### Process Safety

- `tree-kill` — kills entire process tree (not just parent), preventing zombie processes
- SIGTERM → 5s grace → SIGKILL
- Exit handlers for ALL runtime states, including `awaiting_permission`
- Atomic session.json writes (write temp → rename)

### ANSI-Safe Parsing

- `LineBuffer` per stream: accumulates raw data until `\n`, THEN applies `stripAnsi`
- Debounce flush (150ms) catches interactive prompts without trailing `\n`
- No regex over megabyte buffers (prevents ReDoS)

### Reasoning for Claude

- Claude receives `reasoning_chunk` for every `NEEDS_CLAUDE` by default
- Buffer compression: deterministic sliding window (head 15% + scored middle + tail 30%)
- `codex_get_raw_chunk` is a Claude-triggered fallback, not automatic

### codex_ask Integrity

- **Fast path**: `git status --porcelain -uall` before/after (preferred)
- **Fallback**: filesystem snapshot excluding `node_modules`, `.git`, etc.
- Returns `failure_kind: filesystem_violation` if any changes detected
- Limit: 50,000 files before `snapshot_too_large` is returned

## Session Recovery

When a session is interrupted (MCP restart, crash), recovery uses `task_lineage_id`:

```typescript
codex_start_session({
  task: "original task",
  plan: [...],
  task_lineage_id: "previous-lineage-id",  // same lineage
  previous_summary: "...",                   // from ended session
})
```

Task-scope cache rules survive restart. Session-scope rules are cleared.
