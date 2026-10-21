---
agent: agent
description: Generate a synthetic reconstruction for a real fixture and summarise its calibration against the CC0 reference data.
tools: ['regista-local/*']
---

Use the Regista MCP tools to:

1. Call `list_matches` and pick the fixture the user names (or the most recent competitive match if none is named).
2. Call `generate_synthetic_match` for that fixture with scenario `${input:scenario:balanced}`.
3. Call `get_match_state` and `get_key_moments` on the generated match.
4. Report in a short table: real score vs reconstructed score, goals per match, shots, xG per team, and the three highest-importance moments with their evidence.
5. Flag any calibration metric outside its reference band, and say what simulator parameter would move it.

State clearly which facts are real (teams, score, scorers, goal minutes) and which are reconstructed (everything else).
