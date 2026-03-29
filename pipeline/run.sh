#!/usr/bin/env bash
#
# Prompt-to-Deploy Pipeline
#
# Usage:
#   ./pipeline/run.sh "Build a landing page for food delivery"
#   ./pipeline/run.sh --framework next "E-commerce site for sneakers"
#   ./pipeline/run.sh --deploy netlify "Portfolio site"
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "Error: node is required"; exit 1; }
command -v claude >/dev/null 2>&1 || { echo "Error: claude CLI is required"; exit 1; }
command -v npx >/dev/null 2>&1 || { echo "Error: npx is required"; exit 1; }

# Run orchestrator
exec node "$SCRIPT_DIR/orchestrator.mjs" "$@"
