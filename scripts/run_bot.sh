#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -d ".venv" ]; then
  # shellcheck disable=SC1091
  source ".venv/bin/activate"
fi

PYTHON_BIN="${PYTHON_BIN:-python3}"
export PYTHONPATH="$ROOT_DIR/src:${PYTHONPATH:-}"

"$PYTHON_BIN" -m citydatebot --check
exec "$PYTHON_BIN" -m citydatebot
