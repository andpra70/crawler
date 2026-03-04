#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

API_PORT="${API_PORT:-6065}"
WEB_PORT="${WEB_PORT:-6064}"

export API_PORT
export WEB_PORT

echo "Starting local dev application"
echo "API: http://localhost:${API_PORT}"
echo "Web: http://localhost:${WEB_PORT}"

npm run dev
