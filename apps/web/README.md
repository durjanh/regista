# Regista web

React 19 + TypeScript + Vite front end for Regista. Types mirror [`docs/API_CONTRACT.md`](../../docs/API_CONTRACT.md) in `src/api/types.ts`.

## Run locally

```bash
# terminal 1: API on :8000
cd services/api && .venv/bin/uvicorn app.main:app --port 8000

# terminal 2: web on :5173 (proxies /api and /mcp to :8000)
cd apps/web && npm install && npm run dev
```

`npm run typecheck` runs a strict type check and `npm run build` produces the production build in `dist/`.

## Routes

| Route | Surface |
|---|---|
| `/` | Fixtures hub, with the real-dataset stat strip and a Data Forge entry |
| `/match/:id` | Matchday fan companion: live replay, Match Pulse, moment feed with evidence, pitch, stats, match facts, head to head |
| `/match/:id/tactics` | Pass network, shape shifts, PPDA, channels, shot map with xG waterfall, moment explorer |
| `/match/:id/ask` | Ask Regista chat, showing citations and MCP tool calls |
| `/match/:id/recap` | Recap studio: report, social pack, audio script, run-sheet, player of the match, fact check |
| `/studio/:id` | Producer console: moment queue, approve or put graphics on air, overlay preview, commentator whisper, latency |
| `/overlay/:id` | Transparent 1920×1080 broadcast overlay for OBS or vMix (`?demo=1` loops sample graphics) |
| `/forge` | Data Forge: natural-language what-if scenarios and the calibration report |
| `/team/:teamId` | Team DNA: 150-year Elo history, record, recent results, top scorers |

## Container

```bash
docker build -t regista-web .
docker run -p 8080:8080 -e API_UPSTREAM=https://<api-fqdn> regista-web
```

nginx serves the SPA on port 8080. It proxies `/api/` and `/mcp` to `API_UPSTREAM` without buffering, so live server-sent-event streams work. `/healthz` returns 200.
