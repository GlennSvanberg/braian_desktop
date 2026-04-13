#!/bin/bash
# AI Pilot Tracker — Cursor Hook
# Runs after each agent response to log usage

CONFIG_FILE="$HOME/.ai-pilot-config"
API_URL="https://slbzmnxyriiuxyevkllu.supabase.co/functions/v1/ingest-event"

# First-run: register pilot
if [ ! -f "$CONFIG_FILE" ]; then
  echo "🚀 Welcome to the AI Pilot Fleet!"
  read -p "Choose your pilot handle: " HANDLE
  RESPONSE=$(curl -s -X POST "https://slbzmnxyriiuxyevkllu.supabase.co/functions/v1/register-pilot" \
    -H "Content-Type: application/json" \
    -d "{\"handle\": \"$HANDLE\"}")
  PILOT_ID=$(echo "$RESPONSE" | grep -o '"pilot_id":"[^"]*"' | cut -d'"' -f4)
  API_TOKEN=$(echo "$RESPONSE" | grep -o '"api_token":"[^"]*"' | cut -d'"' -f4)
  echo "PILOT_ID=$PILOT_ID" > "$CONFIG_FILE"
  echo "API_TOKEN=$API_TOKEN" >> "$CONFIG_FILE"
  echo "✅ Registered as $HANDLE! You're in the fleet."
fi

source "$CONFIG_FILE"

# Collect agent response metadata from environment
MODEL="${CURSOR_AGENT_MODEL:-unknown}"
TOKENS_IN="${CURSOR_TOKENS_IN:-0}"
TOKENS_OUT="${CURSOR_TOKENS_OUT:-0}"
DURATION="${CURSOR_DURATION_MS:-0}"
FILES_CHANGED="${CURSOR_FILES_CHANGED:-[]}"
PROMPT_LEN="${CURSOR_PROMPT_LENGTH:-0}"
ACCEPTED="${CURSOR_ACCEPTED:-true}"

curl -s -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d "{
    \"pilot_id\": \"$PILOT_ID\",
    \"api_token\": \"$API_TOKEN\",
    \"model\": \"$MODEL\",
    \"tokens_in\": $TOKENS_IN,
    \"tokens_out\": $TOKENS_OUT,
    \"duration_ms\": $DURATION,
    \"files_changed\": $FILES_CHANGED,
    \"prompt_length\": $PROMPT_LEN,
    \"accepted\": $ACCEPTED
  }" > /dev/null 2>&1 &
