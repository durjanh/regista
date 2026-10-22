"""Counterfactual replay: what did a planted change really do?

The match is re-simulated N times with the change and N times without it, on paired seeds, from the same teams,
venue and (for real rebuilds) the same real goals. The difference in a mechanism-specific outcome after the
change, with a p10-p90 range, is a measured cause rather than a guess.
"""

from __future__ import annotations

import statistics

from ..forge.matches import build_real_match, build_what_if
from ..forge.reference import slug
from .geometry import channel

METRICS = {
    "press_switch": ("turnovers_high", "Ball regains in the opponent half after the change", "regains"),
    "shape_change": ("xg_against", "Expected goals conceded after the change", "xG"),
    "tiring_fullback": ("flank_attacks", "Opponent attacks down his flank after the change", "attacks"),
    "hot_streak": ("player_xg", "His expected goals during the spell", "xG"),
    "set_piece_routine": ("corner_xg", "Expected goals from corners after the change", "xG"),
    "chaos_spell": ("flips", "Possession changes during the spell", "changes"),
}


def _q(values: list[float]) -> dict:
    v = sorted(values)
    if not v:
        return {"median": 0.0, "p10": 0.0, "p90": 0.0}

    def pct(p: float) -> float:
        i = max(0, min(len(v) - 1, round(p * (len(v) - 1))))
        return round(v[i], 3)
    return {"median": round(statistics.median(v), 3), "p10": pct(0.1), "p90": pct(0.9)}


def _metric(doc: dict, plant: dict) -> float:
    meta, events = doc["meta"], doc["events"]
    mech = plant["mechanism"]
    team_id = plant["team_id"]
    sides = {meta["home"]["team_id"]: meta["away"]["team_id"], meta["away"]["team_id"]: meta["home"]["team_id"]}
    t0 = plant["t"]
    t1 = t0 + plant.get("duration", 30) * 60 if mech in ("hot_streak", "chaos_spell") else 1e9
    after = [e for e in events if t0 <= e["t"] <= t1]
    if mech == "press_switch":
        return sum(1 for e in after if e["team_id"] == team_id and e["type"] in ("tackle", "interception", "recovery") and e["x"] >= 52.5)
    if mech == "shape_change":
        return round(sum(e.get("xg", 0) for e in after if e["type"] == "shot" and e["team_id"] == sides.get(team_id)), 3)
    if mech == "tiring_fullback":
        pos = next((p["position"] for s in ("home", "away") for p in meta[s]["players"] if p["player_id"] == plant.get("player_id")), "RB")
        target = "left" if pos in ("RB", "RWB") else "right"
        opp = sides.get(team_id)
        return sum(1 for e in after if e["team_id"] == opp and e["type"] in ("pass", "carry") and e.get("outcome") == "success"
                   and e.get("end_x", 0) >= 70 and channel(e.get("end_y", 34)) == target)
    if mech == "hot_streak":
        return round(sum(e.get("xg", 0) for e in after if e["type"] == "shot" and e.get("player_id") == plant.get("player_id")), 3)
    if mech == "set_piece_routine":
        corner_ids = {e["possession_id"] for e in after if e["type"] == "corner" and e["team_id"] == team_id}
        return round(sum(e.get("xg", 0) for e in after if e["type"] == "shot" and e["team_id"] == team_id and e["possession_id"] in corner_ids), 3)
    flips, last = 0, None
    for e in after:
        if e["type"] in ("pass", "carry", "dribble", "shot"):
            if last and e["team_id"] != last:
                flips += 1
            last = e["team_id"]
    return flips


def run(doc: dict, plant_id: str, runs: int = 16) -> dict:
    meta = doc["meta"]
    plants = meta["truth"].get("plants", [])
    plant = next((p for p in plants if p["id"] == plant_id), None)
    if not plant:
        raise KeyError(plant_id)
    real = (meta.get("source") or {}).get("real")
    base_plant = {k: v for k, v in plant.items() if k in ("id", "mechanism", "side", "minute", "direction", "difficulty", "duration", "to", "player_id")}
    others = [{k: v for k, v in p.items() if k in ("id", "mechanism", "side", "minute", "direction", "difficulty", "duration", "to", "player_id")}
              for p in plants if p["id"] != plant_id]
    with_vals, without_vals, effects = [], [], []
    for i in range(runs):
        seed = (meta.get("seed") or 1) * 1000 + 17 * i
        if real:
            d_with = build_real_match(real["date"], meta["home"]["name"], meta["away"]["name"], seed=seed, plants=others + [base_plant])
            d_without = build_real_match(real["date"], meta["home"]["name"], meta["away"]["name"], seed=seed, plants=others)
        else:
            kw = {"seed": seed, "max_tries": 1, "neutral": meta.get("venue", "").startswith("Neutral")}
            d_with = build_what_if(slug(meta["home"]["name"]), slug(meta["away"]["name"]), plants=others + [base_plant], **kw)
            d_without = build_what_if(slug(meta["home"]["name"]), slug(meta["away"]["name"]), plants=others, **kw)
        p_with = next((p for p in d_with["meta"]["truth"]["plants"] if p["id"] == plant_id), plant)
        a, b = _metric(d_with, p_with), _metric(d_without, {**p_with})
        with_vals.append(a)
        without_vals.append(b)
        effects.append(a - b)
    name, label, unit = METRICS[plant["mechanism"]]
    eff = _q(effects)
    direction = "more" if eff["median"] > 0 else "fewer" if eff["median"] < 0 else "no change in"
    return {
        "plant": plant, "metric": {"name": name, "label": label, "unit": unit}, "runs": runs,
        "with_change": _q(with_vals), "without_change": _q(without_vals), "effect": eff,
        "explanation": (f"Across {runs} paired re-runs of this match, '{plant['description']}' produced "
                        f"{abs(eff['median']):g} {direction if direction != 'no change in' else 'change in'} {unit} (median; "
                        f"p10 {eff['p10']:g} to p90 {eff['p90']:g}) on the measure '{label.lower()}'."),
    }
