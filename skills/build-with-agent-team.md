# Build with Agent Team Skill

## Description

Coordinate a multi-agent build where multiple Claude instances work simultaneously in parallel via tmux split panes. Spawns a team of specialized agents (frontend, backend, database, etc.) that collaborate on complex projects using contract-first development.

## Installation

Installed from [coleam00/context-engineering-intro](https://github.com/coleam00/context-engineering-intro/tree/main/use-cases/build-with-agent-team).

Skill file: `~/.claude/skills/build-with-agent-team/SKILL.md`

Requires experimental agent teams feature enabled in `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

Also requires **tmux**:

```bash
# Ubuntu/Debian
sudo apt install tmux

# macOS
brew install tmux
```

## Usage

```
/build-with-agent-team [plan-path] [num-agents]
```

Examples:

```
/build-with-agent-team ./plan.md
/build-with-agent-team ./plan.md 3
```

## How It Works

1. Lead agent reads the plan document
2. Determines optimal team size (2–5+ agents) based on components
3. Defines integration contracts upfront (API shapes, URLs, data models)
4. Spawns all agents in parallel via tmux panes in Delegate Mode
5. Coordinates agents, relays contract deviations, unblocks dependencies
6. Runs end-to-end validation after all agents complete

## Team Size Guidelines

| Agents | Use case |
|--------|----------|
| 2 | Simple frontend/backend split |
| 3 | Full-stack (frontend, backend, database) |
| 4 | Complex system + testing/DevOps |
| 5+ | Large system with many independent modules |

## Notes

- Requires tmux for split-pane visualization
- Lead agent stays in Delegate Mode — does not implement code directly
- All contracts (API URLs, response shapes, SSE formats) must be defined before spawning agents
- See `~/.claude/skills/build-with-agent-team/example-plan/` for a sample plan
