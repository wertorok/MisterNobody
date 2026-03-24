# Design Advisor Skill

Installed from: Design Advisor by Kostya (Vibe coding guide)

Location: `~/.claude/skills/design`

## Description

A design advisor skill that provides professional, industry-specific UI/UX recommendations in seconds. Contains 550+ design rules across 7 data files covering 40+ industries.

## Usage

Use `/design` followed by a description of what you're building:

```
/design landing page for a SaaS project management tool
/design dashboard for a fintech portfolio tracker
/design homepage for a local restaurant
```

## Output

Each `/design` run returns:

1. **Style Direction** — recommended visual style and reasoning
2. **Color Palette** — 6 hex codes with roles (primary, secondary, CTA, background, text, border)
3. **Typography** — font pairing with direct Google Fonts link
4. **Page Structure** — section order and CTA placement
5. **Key Effects** — animations and interactions to use
6. **Anti-Patterns** — what to avoid, severity-ranked (HIGH first)
7. **21st.dev Examples** — real components (if MCP connected)
8. **Next Step** — `/ui` command to start building

## Data Files

| File | Contents |
|------|----------|
| `colors.csv` | 40+ industry color palettes (6 roles each) |
| `typography.csv` | 15 font pairings with mood and Google Fonts links |
| `ui-reasoning.csv` | 30+ industry design patterns and anti-patterns |
| `styles.csv` | 10 visual design styles with implementation examples |
| `landing.csv` | 15 landing page layout patterns and CTA strategies |
| `ux-guidelines.csv` | 30+ UX do/don't rules with code examples |
| `charts.csv` | 12 data visualization recommendations |

## Features

- Industry-specific color palettes with exact hex codes
- Font pairing recommendations with one-click Google Fonts links
- Landing page layout patterns with section order and CTA placement
- Anti-pattern warnings ranked by severity (HIGH / MEDIUM / LOW)
- UX rules with code examples for do's and don'ts
- Chart type recommendations for data visualization
- Optional 21st.dev MCP integration for real component examples

## Extending

Add rows to any CSV file in `~/.claude/skills/design/data/` to expand the database. The skill scales with your data — start with 10-20 rows and grow to 100+.
