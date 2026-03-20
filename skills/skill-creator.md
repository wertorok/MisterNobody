# Skill Creator

## Description

Meta-skill for creating new Claude Code skills. Use this to scaffold, write, and register new skills — either for local use or to publish to a skill registry.

## Usage

Invoke with `/skill-creator` and describe the skill you want to create.

## What is a Skill?

A Claude Code skill is a markdown file that lives in `~/.claude/skills/<skill-name>/` or in a project's `skills/` directory. It provides Claude with structured instructions for a specific task or tool integration.

## Skill Anatomy

```
skills/
└── my-skill.md        # Skill definition file
```

A skill file contains:
- **Description** — what the skill does
- **Installation** — dependencies or setup steps
- **Usage** — how to invoke it (e.g. `/my-skill`)
- **Commands** — available commands with examples
- **Features** — key capabilities
- **Notes** — caveats, requirements, limitations

## Creating a New Skill

### 1. Scaffold the file

```bash
mkdir -p ~/.claude/skills/my-skill
touch ~/.claude/skills/my-skill/README.md
```

### 2. Write the skill definition

```markdown
# My Skill

## Description
Brief description of what this skill does.

## Installation
Steps to install dependencies.

## Usage
Invoke with `/my-skill [args]`.

## Commands
\`\`\`bash
my-tool command --flag value
\`\`\`

## Features
- Feature one
- Feature two

## Notes
- Any important caveats
```

### 3. Register in settings.json

```json
{
  "skills": [
    "~/.claude/skills/my-skill"
  ]
}
```

### 4. Reload Claude Code

Restart or run `/reload` to pick up the new skill.

## Publishing a Skill

To share a skill as a GitHub repository:

```bash
# Create repo
gh repo create my-skill --public
cd my-skill
cp ~/.claude/skills/my-skill/README.md .
git add . && git commit -m "Initial skill"
git push

# Others can install with:
# /install-skill github:username/my-skill
```

## Best Practices

- Keep skills focused on a single tool or workflow
- Include real, runnable command examples
- Document required env vars and auth steps
- Add a **Notes** section for gotchas and limitations
- Version your skill with git tags

## Tips

- Ask Claude: "create a skill for `<tool-name>`" to auto-generate a skill file
- Use `/simplify` after generating to review and clean up
- Test each command before publishing
