"""Scenario Director agent: turns a natural-language request into a what-if simulation config.

"England v Brazil, a late comeback" -> {home_team_id: england, away_team_id: brazil, scenario: comeback}.
The simulator then searches seeds until the requested story actually happens (guaranteed scenario).
"""

from __future__ import annotations

import json
import re

from ..forge.reference import reference, slug
from ..forge.simulator import SCENARIOS
from . import agents
from .agents import AgentSpec

KEYWORDS = [
    (r"comeback|come back|from behind|turn(ed)? it around", "comeback"),
    (r"late|stoppage|last.minute|injury time|drama", "late_drama"),
    (r"red card|sent off|ten men|10 men", "red_card"),
    (r"derby|rivalry|fiery|heated|feisty", "derby"),
    (r"tactical|chess|cagey|tight|low.scoring", "tactical_chess"),
    (r"goal ?fest|goals galore|thriller|high.scoring|crazy", "goal_fest"),
    (r"upset|giant.killing|underdog|shock", "underdog"),
]


def offline_parse(prompt: str) -> tuple[dict, str]:
    ref = reference()
    text = prompt.lower()
    ranked = {t["team_id"] for t in ref.ranking()}
    found: list[tuple[int, str]] = []
    for tid, name in ref.names.items():
        if tid not in ranked:
            continue
        idx = text.find(name.lower())
        if idx >= 0:
            found.append((idx, tid))
    found.sort()
    teams = []
    for _, tid in found:
        if tid not in teams and not any(tid != t and tid in t for t in teams):
            teams.append(tid)
    top = [t["team_id"] for t in ref.ranking(limit=8)]
    home = teams[0] if teams else top[0]
    away = teams[1] if len(teams) > 1 else next(t for t in top if t != home)
    scenario = next((s for pattern, s in KEYWORDS if re.search(pattern, text)), "balanced")
    year = re.search(r"\b(19[0-9]{2}|20[0-2][0-9])\b", text)
    cfg = {"home_team_id": home, "away_team_id": away, "scenario": scenario, "intensity": 0.85 if scenario == "derby" else 0.5}
    if year:
        cfg["as_of"] = f"{year.group(1)}-07-01"
    expl = f"{ref.name_of(home)} v {ref.name_of(away)}, scenario '{scenario}'" + (f", team strength as of {cfg['as_of']}" if year else ", current Elo strength")
    return cfg, expl


async def direct(prompt: str) -> dict:
    if agents.mode() != "offline":
        ref = reference()
        teams = ", ".join(f"{t['team_id']} ({t['name']})" for t in ref.ranking(limit=80))
        spec = AgentSpec("ScenarioDirector", instructions=(
            "You configure a football match simulator. Map the user's request to JSON: "
            '{"home_team_id": str, "away_team_id": str, "scenario": one of ' + json.dumps(list(SCENARIOS)) +
            ', "intensity": 0..1, "as_of": "YYYY-MM-DD" or null, "explanation": str}. '
            f"Valid team ids: {teams}. Use as_of only when the user mentions an era or year. "
            "The explanation is one plain sentence for the producer describing the match you set up and what to expect, "
            "e.g. \"Argentina host Uruguay in a fierce derby at high intensity: expect plenty of fouls and cards.\" "
            "Never mention field names, JSON or your own reasoning, and use no em dashes."))
        try:
            res = await agents.run(spec, prompt, json_mode=True, max_tokens=400)
            cfg = json.loads(res.text)
            if cfg.get("home_team_id") in ref.names and cfg.get("away_team_id") in ref.names and cfg.get("scenario") in SCENARIOS:
                expl = cfg.pop("explanation", "")
                cfg = {k: v for k, v in cfg.items() if v is not None}
                return {"config": cfg, "explanation": expl, "engine": "azure"}
        except Exception:
            pass
    cfg, expl = offline_parse(prompt)
    return {"config": cfg, "explanation": expl, "engine": "offline"}


__all__ = ["direct", "offline_parse", "slug"]
