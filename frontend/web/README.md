# Regista web

React 19 + TypeScript + Vite front end for Regista. Types mirror [`docs/API_CONTRACT.md`](../../docs/API_CONTRACT.md) in `src/api/types.ts`.

## Run locally

```bash
# terminal 1: API on :8000
cd backend/api && .venv/bin/uvicorn app.main:app --port 8000

# terminal 2: web on :5173 (proxies /api and /mcp to :8000)
cd frontend/web && npm install && npm run dev
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

## Hosting: Azure Static Web Apps

In Azure the SPA is a static build on **Azure Static Web Apps** (global edge, managed TLS). It calls the API directly, with fetch and server-sent events, at the URL baked in at build time:

```bash
VITE_API_BASE_URL=https://<api-host> npm run build      # azd, the workflows and scripts/deploy.sh do this for you
```

The API's `CORS_ORIGINS` allows only the Static Web App's origin. `public/staticwebapp.config.json` sends every client route (for example `/studio/:id` and `/overlay/:id`) to `index.html` and sets caching and security headers. Locally `VITE_API_BASE_URL` stays empty and Vite proxies `/api` and `/mcp` to `localhost:8000`.
