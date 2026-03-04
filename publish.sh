#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

git add .
git commit -m "Update watermarks site"
git push
