#!/bin/bash
set -euo pipefail

export API_PORT="${API_PORT:-6065}"

node src/server.js &
api_pid=$!

cleanup() {
  if kill -0 "$api_pid" 2>/dev/null; then
    kill "$api_pid"
    wait "$api_pid" || true
  fi
}

trap cleanup EXIT INT TERM

nginx -g 'daemon off;'
