"""Match detail views assembled from the analyzer: one moment's sequence and xG breakdown, the physical report."""

from __future__ import annotations

from ..analytics.stats import possession_chain
from ..analytics.xg import shot_xg
from ..forge import physical


def moment_detail(an, moment_id: str) -> dict:
    """The moment, the possession chain that led to it, the freeze frame and the xG breakdown. KeyError if unknown."""
    m = next((m for m in an.analyze()["moments"] if m["id"] == moment_id), None)
    if not m:
        raise KeyError(moment_id)
    by_id = {e["id"]: e for e in an.events}
    shot = next((by_id[eid] for eid in reversed(m["event_ids"]) if eid in by_id and by_id[eid]["type"] == "shot"), None)
    anchor = shot or (by_id.get(m["event_ids"][-1]) if m["event_ids"] else None)
    sequence = possession_chain(an.events, anchor["id"]) if anchor else []
    breakdown = None
    if shot:
        assist = by_id.get(shot.get("assist_event_id")) if shot.get("assist_event_id") else None
        breakdown = {"event_id": shot["id"], **shot_xg(shot, assist.get("pass_type") if assist else None)}
        breakdown["xg"] = shot.get("xg", breakdown["xg"])
    return {"moment": m, "sequence": sequence, "freeze_frame": shot.get("freeze_frame") if shot else None, "xg_breakdown": breakdown}


def physical_report(doc: dict, an, upto_t: float | None) -> dict:
    """Distance, sprints and top speed per player up to the clock, longest distance first."""
    t = an.end_t if upto_t is None else min(upto_t, an.end_t)
    phys = physical.upto(doc.get("physical") or physical.compute(doc), doc["meta"], t, an.end_t)
    roster = {p["player_id"]: p for s in ("home", "away") for p in doc["meta"][s]["players"]}
    rows = [{"player_id": pid, "player_key": roster[pid].get("player_key"), "name": roster[pid]["name"], "team_id": roster[pid]["team_id"],
             "position": roster[pid]["position"], "minutes": v["minutes"], "distance_km": v["distance_km"], "sprints": v["sprints"],
             "top_speed_kmh": v["top_speed_kmh"], "by_15": v["by_15"]} for pid, v in phys.items() if pid in roster]
    rows.sort(key=lambda r: -r["distance_km"])
    return {"players": rows}
