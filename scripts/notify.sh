#!/usr/bin/env bash
# Send a message to your Telegram bot from shell
# Usage: ./scripts/notify.sh "Your message here"
#
# Uses TELEGRAM_BOT_TOKEN and ALLOWED_CHAT_ID from .env

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env not found at $ENV_FILE" >&2
  exit 1
fi

# Parse .env
while IFS='=' read -r key value; do
  [[ "$key" =~ ^#.*$ ]] && continue
  [[ -z "$key" ]] && continue
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  export "$key=$value"
done < "$ENV_FILE"

if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$ALLOWED_CHAT_ID" ]; then
  echo "Error: TELEGRAM_BOT_TOKEN and ALLOWED_CHAT_ID must be set in .env" >&2
  exit 1
fi

MESSAGE="${1:-ClaudeClaw notification}"

curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\": \"${ALLOWED_CHAT_ID}\", \"text\": \"${MESSAGE}\", \"parse_mode\": \"HTML\"}" \
  > /dev/null

echo "Sent: $MESSAGE"
