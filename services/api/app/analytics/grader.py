"""Grader: scores what the agents said against what the generator secretly planted.

A hit needs the right team, mechanism and direction, a detected change point within a window around the planted
time, and a detection that did not come before the change itself. Explanations are written from structured
fields, so an explanation is correct when those fields (team, mechanism, direction and, where relevant, the
player) match the plant. Insights that match nothing planted are false alarms, except changes the engine made on
its own and recorded (natural substitutions that reshape a team), which are reported separately.
"""

from __future__ import annotations

import statistics

WINDOW_BEFORE = 4
WINDOW_AFTER = 12


def _direction_ok(plant: dict, insight: dict) -> bool:
    mech = plant["mechanism"]
    if mech == "press_switch":
        return insight["direction"] == plant.get("direction", "higher")
    if mech == "shape_change":
        want = plant.get("direction", "back_five")
        return insight["direction"] == want or (want == "attacking" and insight["direction"] in ("back_three", "back_four"))
    return True


def observable(plant: dict, events: list[dict], end_t: float) -> bool:
    """Could anyone have seen this change in the data? A near-post routine needs corners, a hot streak needs shots,
    a tiring full-back needs to stay on the pitch, and every change needs time left after it."""
    t0 = plant["t"]
    if end_t - t0 < 10 * 60:
        return False
    mech = plant["mechanism"]
    if mech == "set_piece_routine":
        return sum(1 for e in events if e["type"] == "corner" and e["team_id"] == plant["team_id"] and e["t"] >= t0) >= 2
    if mech == "hot_streak":
        spell_end = t0 + plant.get("duration", 15) * 60
        return sum(1 for e in events if e["type"] == "shot" and e.get("player_id") == plant.get("player_id") and t0 <= e["t"] <= spell_end) >= 3
    if mech == "tiring_fullback":
        off = next((e["t"] for e in events if e["type"] == "substitution" and e.get("sub_out") == plant.get("player_id") and e["t"] >= t0), end_t)
        return off - t0 >= 10 * 60
    return True


def grade(plants: list[dict], insights: list[dict], natural_labels: list[dict], upto_minute: int | None = None,
          events: list[dict] | None = None) -> dict:
    grades, used = [], set()
    end_t = events[-1]["t"] if events else 1e9
    for p in plants:
        reached = upto_minute is None or upto_minute >= p["minute"]
        if not reached:
            grades.append({"plant_id": p["id"], "mechanism": p["mechanism"], "team_id": p["team_id"], "difficulty": p.get("difficulty", "obvious"),
                           "detected": False, "pending": True})
            continue
        cands = [i for i in insights if i["id"] not in used and i["mechanism"] == p["mechanism"]
                 and (p["team_id"] == "both" or i["team_id"] == p["team_id"])
                 and p["minute"] - WINDOW_BEFORE <= i["start_minute"] <= p["minute"] + WINDOW_AFTER
                 and i["detected_minute"] >= p["minute"] - 1 and _direction_ok(p, i)]
        cands.sort(key=lambda i: i["detected_t"])
        g = {"plant_id": p["id"], "mechanism": p["mechanism"], "team_id": p["team_id"], "difficulty": p.get("difficulty", "obvious"),
             "detected": bool(cands), "observable": observable(p, events, end_t) if events else True}
        if cands:
            i = cands[0]
            used.add(i["id"])
            g["insight_id"] = i["id"]
            g["seconds_to_detect"] = max(0, round(i["detected_t"] - p["t"]))
            g["explanation_correct"] = (not p.get("player_id")) or i.get("player_id") == p.get("player_id")
        grades.append(g)
    natural = []
    false_alarms = []
    for i in insights:
        if i["id"] in used:
            continue
        is_natural = (i["mechanism"] == "shape_change" and any(
            lab["type"] == "formation_change" and lab["team_id"] == i["team_id"] and abs(lab["minute"] - i["start_minute"]) <= 12
            for lab in natural_labels)) or (i["mechanism"] == "press_switch" and any(
            lab["type"] == "press_change" and lab["team_id"] == i["team_id"] and lab.get("direction") == i["direction"]
            and -10 <= i["start_minute"] - lab["minute"] <= 20 for lab in natural_labels))
        (natural if is_natural else false_alarms).append(i)
    reached = [g for g in grades if not g.get("pending") and (g.get("observable", True) or g["detected"])]
    detected = [g for g in reached if g["detected"]]
    secs = [g["seconds_to_detect"] for g in detected if g.get("seconds_to_detect") is not None]
    return {
        "grades": grades, "false_alarms": false_alarms, "natural": natural,
        "score": {"recall": round(len(detected) / len(reached), 3) if reached else None, "false_alarms": len(false_alarms),
                  "median_seconds_to_detect": round(statistics.median(secs)) if secs else None,
                  "explanation_accuracy": round(sum(1 for g in detected if g.get("explanation_correct")) / len(detected), 3) if detected else None},
    }
