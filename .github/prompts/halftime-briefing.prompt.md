---
agent: agent
description: Produce a 60-second half-time studio briefing for a match, grounded in Regista's evidence.
tools: ['regista-local/*', 'regista-cloud/*']
---

For match `${input:matchId}`:

1. `get_match_state` at minute 45 and `compare_periods` for 0–20 vs 20–45.
2. `get_key_moments` up to minute 45 (min importance 60) and `explain_moment` for the top two.
3. `get_tactical_summary` for both teams.

Write a broadcast half-time briefing:
- **Headline** (one line)
- **Three talking points**, each with one cited number (`xG 0.41`, `PPDA 7.2`, `event e01234`)
- **Tactical note**: formation, pressing and the channel each team is attacking
- **What to watch in the second half**

Every number must come from a tool result. Describe players through actions and metrics, not innate traits.
