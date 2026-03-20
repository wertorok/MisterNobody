# Vercel CLI Skill

## Description

Use Vercel CLI directly from Claude Code to deploy projects, manage environments, and interact with Vercel platform resources via the `vercel` command.

## Installation

```bash
npm install -g vercel
```

Authenticate:

```bash
vercel login
```

## Usage

Invoke with `/vercel [command]` or ask Claude to run a Vercel CLI command.

## Commands

```bash
# Deploy current project
vercel

# Deploy to production
vercel --prod

# Pull environment variables
vercel env pull .env.local

# List deployments
vercel ls

# Inspect a deployment
vercel inspect <url>

# Rollback to a previous deployment
vercel rollback

# Run project locally with Vercel config
vercel dev

# Link project to Vercel
vercel link

# Manage environment variables
vercel env add MY_VAR production
vercel env rm MY_VAR production
vercel env ls
```

## Features

- Zero-config deployments for Next.js, Vite, SvelteKit, and more
- Preview deployments on every push
- Edge functions and serverless support
- Environment variable management per environment (development / preview / production)
- Domain and DNS management via CLI
- Instant rollback

## Notes

- Requires a Vercel account and `vercel login`
- Or use `VERCEL_TOKEN` environment variable for CI/CD
- Run `vercel link` first to associate a local directory with a Vercel project
- Use `vercel --help` to see all available commands
