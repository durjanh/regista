#!/usr/bin/env bash
# Runs the API (http://localhost:8000) and the web app (http://localhost:5173) together.
# With no Azure variables set, the API runs in offline mode with deterministic narratives.
# Put Azure settings in backend/api/.env to use Foundry, Speech, Translator and Cosmos DB.
#
# Usage: scripts/local-dev.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# --- API ----------------------------------------------------------------------------------------
cd "$ROOT/backend/api"
if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
.venv/bin/pip install -q -r requirements.txt
if [[ -f .env ]]; then
  set -a; source .env; set +a
fi
export REGISTA_DATA_DIR="${REGISTA_DATA_DIR:-$ROOT/data/matches}"
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &

# --- Web ----------------------------------------------------------------------------------------
cd "$ROOT/frontend/web"
[[ -d node_modules ]] || npm install
npm run dev -- --host &

echo
echo "API  → http://localhost:8000/api/health"
echo "MCP  → http://localhost:8000/mcp"
echo "Web  → http://localhost:5173"
echo "Ctrl+C to stop."
wait
