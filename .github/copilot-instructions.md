# Copilot instructions for Regista

Regista is an AI match-intelligence platform built for the Microsoft × Premier League "Inside the Game" hackathon. It rebuilds **real international matches** from the CC0 results dataset (teams, scores, scorers, goal minutes) and generates **synthetic, football-realistic ball-by-ball events** conditioned on those real goals. It then turns them into explainable insight, live narratives and recaps for broadcast, studio and fan experiences.

## Hard rules

- **Real results, synthetic events.** Match results come only from the CC0 dataset in `data/reference/international-results/` (martj42/international_results). Everything below the result (passes, shots, positions, xG) is a synthetic reconstruction, and the UI and AI text must never present it as recorded fact. Team strength comes from Elo computed over all results. Never add Premier League club data, crests, logos or footage.
- **Grounded or silent.** AI text must come from computed facts (`fact_id`s) and pass the fact-checker. Never let a model invent a number.
- **Keyless.** Use `DefaultAzureCredential` / managed identity for every Azure call. Never add API keys, connection strings or SAS tokens to code, config or Bicep.
- **Offline mode must keep working.** Every Azure dependency is optional; with no environment variables set, the API runs with deterministic narratives.
- `docs/API_CONTRACT.md` is the source of truth for endpoints, types and environment variables. Update it first when a contract changes.

## Layout

| Path | What |
|---|---|
| `backend/api` | Python 3.12 FastAPI: real-result loader + Elo, conditioned event simulator (Data Forge), analytics (xG, xT, win probability, tactics), Agent Framework multi-agent workflows, MCP server at `/mcp` |
| `frontend/web` | React + TypeScript (Vite): fan companion, studio console, broadcast overlay, tactics board, Ask Regista, recap studio, Data Forge |
| `backend/functions` | Azure Functions (Flex Consumption): full-time recap automation from Event Hubs |
| `infra` | Bicep, resource-group scope, idempotent; `main.bicep` + `modules/` |
| `.github/workflows` | CI, infrastructure (what-if → deploy), app deploy, Foundry evaluations |
| `scripts` | GitHub OIDC bootstrap (az + gh), developer access, Fabric setup, local dev |

## Conventions

- Python: type hints, `ruff`, `pytest`. Pure-Python analytics; keep heavy dependencies out of the hot path.
- Frontend: function components, hooks, design tokens on `:root`, accessible by default (keyboard, focus, `aria-live` for live commentary).
- Bicep: deterministic names from `modules/naming.bicep`, deterministic role-assignment GUIDs (`guid(scope, principal, role)`), role definition ids as verified GUIDs with a comment naming the role, `az bicep lint` clean.
- Commit messages: imperative mood, explain the why.

## Useful commands

```bash
scripts/local-dev.sh                                  # API :8000 + web :5173
cd backend/api && pytest -q && ruff check .          # backend checks
python -m app.evals.run --mode offline --threshold 0.95
cd frontend/web && npm run typecheck && npm run build     # frontend checks
az bicep build --file infra/main.bicep && az bicep lint --file infra/main.bicep
```

## MCP servers (see `.vscode/mcp.json`)

- `regista-local` / `regista-cloud`: match intelligence tools (`get_match_state`, `get_key_moments`, `explain_moment`, `get_tactical_summary`, `generate_synthetic_match`, …)
- `azure-mcp`: inspect the deployed Azure resources
- `microsoft-learn`: verify API versions, role ids, SDK usage before writing code
