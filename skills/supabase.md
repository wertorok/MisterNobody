# Supabase CLI Skill

## Description

Use Supabase CLI directly from Claude Code to manage projects, run local development stacks, handle migrations, and interact with Supabase platform resources.

## Installation

```bash
npm install -g supabase
```

Or via Homebrew:

```bash
brew install supabase/tap/supabase
```

Authenticate:

```bash
supabase login
```

## Usage

Invoke with `/supabase [command]` or ask Claude to run a Supabase CLI command.

## Commands

```bash
# Initialize Supabase in current project
supabase init

# Link to a remote Supabase project
supabase link --project-ref <project-id>

# Start local Supabase stack (Postgres, Auth, Storage, etc.)
supabase start

# Stop local stack
supabase stop

# Create a new migration
supabase migration new <migration-name>

# Apply pending migrations to local DB
supabase db reset

# Push migrations to remote project
supabase db push

# Pull schema changes from remote to local
supabase db pull

# Generate TypeScript types from database schema
supabase gen types typescript --local > src/database.types.ts

# Deploy Edge Functions
supabase functions deploy <function-name>

# Serve Edge Functions locally
supabase functions serve

# View project status
supabase status

# Open Supabase Studio in browser
supabase studio
```

## Features

- Full local development stack (Postgres, GoTrue, PostgREST, Realtime, Storage)
- Database migration management with version control
- TypeScript type generation from DB schema
- Edge Functions deployment and local serving
- Row Level Security policy management
- Secrets management for Edge Functions
- Branching support for preview environments

## Notes

- Requires Docker for local development stack
- Run `supabase login` to authenticate with Supabase cloud
- Use `supabase link` to connect local project to remote instance
- `supabase db reset` will wipe and reseed local database
