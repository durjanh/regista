# Regista: entry plan

**Inside the Game: Developer Hackathon (Microsoft + Premier League).** Submission closes **11:59 PM Pacific on Tue 27 Oct 2026**, which is **6:59 AM UK time on Wed 28 Oct**. We submit on the **evening of Tue 27 Oct UK time**, not at the deadline. Judging runs 27 Oct to 10 Nov, so the demo stays live until **10 Nov 2026**.

**Category: Best Enterprise Solution**, while competing for the Grand Prize. A project can win one Grand Prize and one category prize, and judges can reassign categories.

> *Regista* is the deep-lying playmaker who sees the whole pitch and dictates the tempo. The product reads the game, explains what changed and why, and proves every claim.

This plan follows *Inside the Game Hackathon — Entry Plan* (20 Oct). Section 1 lists where we deliberately differ from it.

---

## 1. Decisions against the entry plan

| Entry plan | Regista | Why |
|---|---|---|
| Working name "GroundTruth" | **Regista** | Avoids the clash with Amazon SageMaker Ground Truth at a Microsoft hackathon |
| Fictional league, clubs and players | **Real results, synthetic events** (CC0 dataset), labelled on every screen | Decided on 20 Oct: judges want "real synthetic data and real results". Video-safe mode scrubs trademarked competition names; player names are a remaining video risk (§10) |
| Agents in C# | Agents in **Python** on Microsoft Agent Framework | Stack decided as React + Python. One language for generator, detectors, Grader and agents |
| Fluent UI 2 | Custom broadcast-style React UI | Already built and consistent across the 14 screens |
| `azd` | **azd** for all three profiles (`azure.yaml`, `deploy/aks`, `deploy/aks-enterprise`), plus `scripts/deploy.sh`, GitHub Actions and Azure Pipelines | What-if, provision, build, roll out, smoke test |
| Key Vault | Not deployed | There are no secrets: every call uses Entra ID and one managed identity, with key auth disabled. Add Key Vault only if a secret ever appears |
| Live features from Eventhouse KQL | Live features computed in the API from the event stream; Eventhouse for investigations | This is the plan's own fallback for slow Fabric ingestion. Each insight carries its KQL query as a receipt, and the Fabric RTI MCP server is wired up in `.vscode/mcp.json` |
| Web PubSub | Server-sent events | Enough for the demo. Web PubSub is the documented scale path (`docs/ARCHITECTURE.md`) |
| Front Door in front of everything | **API Management Standard v2 is the enterprise edge**; Front Door Premium + WAF is documented as the next step (`docs/ARCHITECTURE.md`) | Simpler (no Private Link approval or two-pass provision) and about $330 a month cheaper; the trade-off is no WAF for the demo |
| Grader agent | **Deterministic Grader** | The plan's own rule: grading compares structured fields, not opinions |
| A2A broadcaster agent, auto-eventing from tracking | Not built | Stretch items, and the first things the plan says to cut |

## 2. Elevator pitch (ready to paste)

Broadcasters want AI insight on screen, but one wrong stat on air costs trust, and AI commentary usually cannot be checked. Regista is a live match-intelligence studio that proves every claim. Our synthetic match engine rebuilds real international results event by event and secretly plants tactical changes. Microsoft Agent Framework agents on Azure Container Apps detect and explain them from the live event stream (Event Hubs, landed in Microsoft Fabric Real-Time Intelligence). A Verifier re-checks every number, and a human producer approves what airs as timed overlays, personalised for analysts, casual fans and managers in several languages. A Grader scores every explanation against the planted truth, live and in CI. Built with Microsoft Foundry, Agent Framework, MCP, Fabric, Azure AI services, Cosmos DB and GitHub Copilot.

## 3. Judging criteria (five × 20%; ties go to Technological Implementation)

| Criterion | How Regista answers it |
|---|---|
| **Technological Implementation** (tie-breaker; rewards creative synthetic data) | Planted-truth generator calibrated on 49,945 real results; a full synthetic season for OneLake with a realism report; Agent Framework; MCP; Fabric; tests, lint and evaluation gates in CI |
| **Agentic Design and Innovation** | Detector → Analyst → Verifier (retry) → Producer → human, with a Grader the agents never see. The Verifier drill plants claim errors to prove the Verifier works. Ask agent and GitHub Copilot share one MCP tool surface |
| **Real-World Impact** | A producer's real workflow: ranked cues, approve/edit/kill, broadcaster profiles, cue contract for OBS/vMix, audit log, SLO and cost per match. A manager's Dugout and scouting files |
| **User Experience and Presentation** | Control room, air-ready overlays, fan views that differ in layout and pace, the hero moment by 0:20 in the video |
| **Adherence to Category** (Enterprise) | Enterprise controls on screen and in the README: humans decide, keyless, quality gates, observability, budget, audit |

## 4. What we built

| Surface | Route | Stand-out |
|---|---|---|
| Control room | `/studio/:id` | Insight cards that show their working; approve/edit/kill; auto-approve threshold; editorial rules; audit log; broadcaster profiles; truth mode and the truth panel; Verifier drill; counterfactual "What did it change?"; half-time pack; Jump to 58:00 |
| Overlay | `/overlay/:id` | Transparent 1920×1080 browser source driven by the versioned cue contract |
| Matchday | `/match/:id?view=` | Five views that differ in layout and pace: Analyst, Casual, Player focus, Club focus, Single metric. Plus Match Pulse, control vs chaos, freeze frames, speed and sprint tags, personas, 12 languages, voice, audio description |
| Tactics, Ask, Recap | `/match/:id/...` | Pass networks and profiles, shape changes, xG waterfalls; "Ask the match" over MCP; multi-agent recaps and social packs |
| Dugout | `/match/:id/dugout` | Form vs the player's own baseline, fatigue vs team-mates (altitude-aware), "replace X with Y" with win-probability impact, spoken briefing |
| Scouting | `/scouting` | Player DNA (REAL record + MODEL tendencies), strengths and weaknesses, "how to stop him", team reports |
| Data Forge | `/forge` | What-if matches, calibration report, truth-score history; season generator (`python -m app.forge.season`) |
| Ops | `/ops` | Narrative latency SLO and cost per match |

## 5. Evidence (`python -m app.evals.run --mode offline`, every push)

| Gate | Result |
|---|---|
| Truth score on fresh seeds (48 matches, 12 controls, 63 observable plants) | recall **41%**, **0.92** false alarms per match, median **8.5 min** to detect, explanations **100%** correct when detected |
| Verifier drill | **495/495** planted overstated numbers caught before air |
| Grounding | **100%** of generated outputs pass the fact-checker, 0 fair-commentary flags |
| Real-result fidelity | **100%** (score, scorers, minutes) |
| Calibration vs real fixtures and event ranges | **16/16**; goals-vs-Elo slope 0.0021 engine vs 0.0021 real; win-probability Brier **0.469** (coin flip 0.667) |
| Shape changes vs ground truth | **67%** precision |
| Scouting recovery | foot **100%**, penalty side **82%**, keeper dive **100%** |

Honest by design: scores come from seeds never used for tuning, split by difficulty and mechanism. Showcase misses (France's near-post corner routine, Mexico's tiring right-back) stay in the product as misses.

## 6. The hero moment (England 1–2 Argentina, 2026 semi-final)

| Match time | What happens | Where |
|---|---|---|
| 58:00 | Start the Studio replay at 10× with **Truth mode** and the **Verifier drill** on, profile **UK + Europe (EN/FR/ES)** | Control room |
| 62:14 (63') | The hidden script switches Argentina to a high press | Hidden |
| 64' | Change point in "pressing actions per opponent build-up pass" (0.27 → 0.82); the card shows the trend and the KQL receipt | Insight card |
| 67' | Detected, **4 m 46 s** after the plant. With the drill on, the Analyst's draft overstates 0.82 as 1.76; the **Verifier** flags it as not in the evidence; the Analyst rewrites it to 0.82 | Insight card, Verifier strip |
| Next | The Producer proposes a lower-third; the producer taps approve; it airs in English, French and Spanish (Translator, Azure mode) | Queue, overlay |
| Next | Truth panel: planted press detected, seconds to detect, explanation correct, no false alarms. **What did it change?** gives +5.5 regains in England's half (p10 1, p90 11, 16 paired re-runs) | Truth panel |
| 69' → 72' | England's tiring left-back (planted at 68:30) is detected **3 m 30 s** after the plant | Insight card |

## 7. Demo video script (1:55, hero moment by 0:20)

Record from replay with the deployed URL visible, `REGISTA_VIDEO_SAFE=1`, captions on, Microsoft services named on screen as they appear, no third-party music.

| Time | On screen | Voice-over |
|---|---|---|
| 0:00–0:08 | Control room beside the live pitch, overlays appearing | "One wrong stat on air costs a broadcaster trust. Here, every AI claim goes to VAR, and we grade the result." |
| 0:08–0:20 | Events streaming; speed and sprint tags; pass difficulty; control vs chaos meter | "A real result, rebuilt event by event by our own generator: passes, pressure, shots and speeds." |
| 0:20–0:55 | The hero moment end to end: detection, the Verifier's catch and correction, approval, three languages, truth panel, counterfactual | "In the 63rd minute our generator secretly switched the away side to a high press. Watch the agents find it." |
| 0:55–1:15 | Analyst and casual views side by side (different layout and pace), then player focus; one language with voice | "One insight, made for every fan, in their language." |
| 1:15–1:30 | Dugout "replace X with Y" and a full-time recap in three languages | "For the manager, who's fading and what a change is worth. At the whistle, recaps where every line is checked." |
| 1:30–1:45 | `scripts/deploy.sh`, Foundry/App Insights traces, the CI truth-score summary, the Ops SLO and cost page | "Built for production: managed identity, tracing, evaluation gates, cost control." |
| 1:45–1:55 | Architecture slide, category, truth-score chart | "Regista: match intelligence you can trust, and check." |

## 8. Microsoft technology map

| Technology | Where |
|---|---|
| Microsoft Foundry | `infra/modules/foundry.bicep`: models `gpt-5.4-mini` (chat) and `gpt-5.5` (reasoning), project, evaluations (`.github/workflows/evals.yml`), tracing |
| Microsoft Agent Framework | `services/api/app/ai/agents.py` (`Agent`, `FoundryChatClient`, `ConcurrentBuilder`, `MCPStreamableHTTPTool`); OpenTelemetry instrumentation in `integrations/telemetry.py` |
| MCP | `services/api/app/mcp_server.py` (14 tools at `/mcp`); `.vscode/mcp.json` (Regista, Azure MCP Server, Fabric RTI Eventhouse) |
| GitHub Copilot agent mode | `.github/copilot-instructions.md`, `.github/agents/`, `.github/prompts/`; Copilot-authored pull requests after the repo is created |
| GitHub + CLI | Actions CI/CD with OIDC; `scripts/bootstrap-github-oidc.sh` uses `gh` |
| Azure DevOps | `.azuredevops/pipelines` (CI + azd deploy with approvals; enterprise deploys from a Managed DevOps Pool in the VNet); `scripts/setup-azure-devops.sh` creates a workload-identity service connection |
| Azure AI services | Speech, Translator, Content Safety and Prompt Shields (`ai/services.py`), all Entra-authenticated |
| Microsoft Fabric | Lakehouse (season dataset, realism report, reference CSVs), Eventstream → Eventhouse/KQL (`scripts/fabric-setup.py`, `docs/kql/`) |
| Azure data | Cosmos DB for NoSQL (narratives, studio decisions, audit log, profiles), Blob Storage |
| Cloud native | **Static Web Apps** for the React SPA; Container Apps (API, feeder job) or **AKS** (standard, or private behind **API Management Standard v2** with private endpoints), Event Hubs, Functions (Flex), ACR, App Insights, budget alert |

## 9. Azure: what we need from you

Nothing has been deployed yet, and nothing will be without your go-ahead.
1. A **personal** Azure subscription and tenant (not employer or partner-benefit credits), with Owner, or Contributor plus RBAC Administrator, on a resource group.
2. Model quota in **UK South** for `gpt-5.4-mini` and `gpt-5.5` (Global Standard). Fallbacks are in `docs/DEPLOYMENT.md`.
3. Optional: a free **Fabric trial** for the Lakehouse and Eventhouse.
4. An email address for the budget alert (`--budget-email`).

Rough cost without Fabric: **~$110–200 a month** (estimate; see `docs/ARCHITECTURE.md#cost-estimate`). Keep it running until 10 Nov, then tear it down.

## 10. Remaining days (UK time)

| Day | Focus | Done when |
|---|---|---|
| **Wed 21** | ✅ Truth loop, Verifier drill, governance, Ops, season, docs. Create the **private** GitHub repo and push; `bootstrap-github-oidc.sh` | CI green on GitHub |
| **Thu 22** | Deploy with `scripts/deploy.sh` (after your go-ahead); tune prompts on live models; run `evals.yml` in Azure mode | `/api/health` shows `mode: azure`; p95 under 3 s |
| **Fri 23** | Fabric trial, `fabric-setup.py`, Eventstream → KQL; season upload to OneLake | KQL query returns rows during a live feed |
| **Sat 24** | UX polish on the demo screens; mobile and screen-reader check; README GIF and screenshots; decide the video's player-name approach | Every demo screen has no rough edges |
| **Sun 25** | Record the video (script above), captions, upload as a **public** YouTube/Vimeo video; write the project page | Video under 1:58 |
| **Mon 26** | Dry run as a judge: fresh browser, follow the README, click every link. Make the repo public | A stranger can test it in 5 minutes |
| **Tue 27 (evening UK)** | **Submit**, well before 6:59 AM Wed 28 | Submitted with repo URL, video URL, pitch and testing notes |

## 11. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Running out of time | Cut voice and Ask the match polish first. Never cut the truth score, the Verifier or the approval gate |
| Judges never open the live demo | README with a GIF and screenshots, and a video that stands on its own. Polish these before adding features |
| Real names in the video: rules forbid third-party trademarks, and some player names are registered marks (for example MESSI in the EU) | `REGISTA_VIDEO_SAFE=1` scrubs competition marks from JSON and the live stream. Keep player names out of the voice-over and close-ups, or choose a showcase segment where lines name teams, not players. Decide by Sat 24 |
| "Synthetic data" vs real results | Events are synthetic; real results are the CC0 conditioning layer, labelled on every screen. Ask the organisers in writing if unsure |
| Model latency too slow for live lines | Fast model for live lines, larger one for recaps; data-only overlays fire at once and the AI line follows |
| Fabric ingestion too slow, or no Fabric trial | Live features are computed in the API from Event Hubs. KQL also runs on a free Azure Data Explorer cluster |
| Fabric capacity cost, or a trial lapsing during judging | The product works without Fabric; judge mode replays recorded events from the API |
| Agents miss planted changes | Honest scores by difficulty; the showcase match is the obvious tier; tune features before prompts |
| Judges' actions collide in the shared control room | Studio state is per match; each judge can pick a different match. Add a reset button if it becomes a problem |
| Looking like the public rivals (verifier agents, recaps, voices, MCP) | Lead every asset with the truth score and enterprise controls, not with commentary or voice |
| Azure spend | Budget alert in Bicep from day one; scale the web app to zero between demos |

## 12. Submission checklist

- [ ] Confirm the registration went through; accept the Innovation Studio invitation when it arrives
- [ ] Use a personal Azure subscription and tenant
- [ ] Check your employment contract's rules on outside projects and prizes
- [ ] Repo private until submission (commit dates prove new work after 29 Sep); then public, with licence and no secrets
- [ ] GitHub Copilot agent mode used visibly: `.github/copilot-instructions.md`, Copilot-authored pull requests, a README note on how it helped
- [ ] README: pitch, category, architecture diagram, Microsoft services, truth-score chart, run and deploy steps, synthetic-data statement and screenshots are done (`docs/screenshots/`, regenerate after UI changes); still to do: a GIF of the hero moment from the video recording at the top
- [ ] Project page: elevator pitch, screenshots and the architecture image (judges may score on text, images and video alone)
- [ ] Demo video under 2:00, public URL, English, no third-party marks or music
- [ ] Judge mode: no-login replay of the showcase match with the control room, live until 10 Nov
- [ ] Team members (up to 4) and representative confirmed
- [ ] Submit on the evening of Tue 27 Oct UK time
