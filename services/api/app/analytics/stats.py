"""Team and player statistics from event data."""

from __future__ import annotations

import math
from collections import defaultdict

from .geometry import distance_to_goal

DEFENSIVE_ACTIONS = {"tackle", "interception", "foul"}
TOUCH_TYPES = {"pass", "carry", "dribble", "shot", "kick_off", "throw_in", "goal_kick", "free_kick", "corner",
               "tackle", "interception", "clearance", "recovery", "save"}


def _is_progressive(e: dict) -> bool:
    if e["type"] != "pass" or e.get("outcome") != "success" or e["x"] < 35:
        return False
    d0, d1 = distance_to_goal(e["x"], e["y"]), distance_to_goal(e["end_x"], e["end_y"])
    return d0 - d1 >= 10 and d1 <= 0.75 * d0


def team_stats(events: list[dict], team_id: str, opp_id: str) -> dict:
    mine = [e for e in events if e["team_id"] == team_id]
    theirs = [e for e in events if e["team_id"] == opp_id]
    passes = [e for e in mine if e["type"] == "pass"]
    opp_passes = [e for e in theirs if e["type"] == "pass"]
    shots = [e for e in mine if e["type"] == "shot"]
    goals = sum(1 for e in shots if e.get("shot_outcome") == "goal")
    # PPDA: opponent passes in their own defensive 60% / our defensive actions in that zone (our attacking 40%+)
    opp_build = sum(1 for e in opp_passes if e["x"] < 63)
    our_def = sum(1 for e in mine if e["type"] in DEFENSIVE_ACTIONS and e["x"] > 42)
    final_third_mine = sum(1 for e in passes if e["x"] >= 70)
    final_third_theirs = sum(1 for e in opp_passes if e["x"] >= 70)
    entries = sum(1 for e in mine if e["type"] in ("pass", "carry") and e.get("outcome") == "success"
                  and e["x"] < 70 <= e.get("end_x", 0))
    total_passes = len(passes) + len(opp_passes)
    return {
        "team_id": team_id,
        "goals": goals,
        "xg": round(sum(e.get("xg", 0) for e in shots), 2),
        "shots": len(shots),
        "shots_on_target": sum(1 for e in shots if e.get("shot_outcome") in ("goal", "saved")),
        "big_chances": sum(1 for e in shots if "big_chance" in (e.get("tags") or []) or (e.get("xg", 0) >= 0.3)),
        "passes": len(passes),
        "pass_completion": round(sum(1 for e in passes if e["outcome"] == "success") / len(passes), 3) if passes else 0.0,
        "possession": round(len(passes) / total_passes, 3) if total_passes else 0.5,
        "progressive_passes": sum(1 for e in passes if _is_progressive(e)),
        "final_third_entries": entries,
        "xt": round(sum(e.get("xt_added", 0) for e in mine if e.get("xt_added", 0) > 0), 2),
        "corners": sum(1 for e in mine if e["type"] == "corner"),
        "fouls": sum(1 for e in mine if e["type"] == "foul"),
        "yellow": sum(1 for e in mine if e.get("card") == "yellow"),
        "red": sum(1 for e in mine if e.get("card") in ("red", "second_yellow")),
        "offsides": sum(1 for e in mine if e["type"] == "offside"),
        "tackles": sum(1 for e in mine if e["type"] == "tackle"),
        "interceptions": sum(1 for e in mine if e["type"] == "interception"),
        "ppda": round(opp_build / our_def, 2) if our_def else 0.0,
        "field_tilt": round(final_third_mine / (final_third_mine + final_third_theirs), 3) if (final_third_mine + final_third_theirs) else 0.5,
    }


def player_stats(events: list[dict], meta: dict, upto_t: float | None = None) -> list[dict]:
    players = {p["player_id"]: (p, side) for side in ("home", "away") for p in meta[side]["players"]}
    on: dict[str, float] = {}
    off: dict[str, float] = {}
    for side in ("home", "away"):
        for p in meta[side]["players"]:
            if p["starter"]:
                on[p["player_id"]] = 0.0
    end_t = upto_t if upto_t is not None else (events[-1]["t"] if events else 0)
    s = defaultdict(lambda: defaultdict(float))
    for e in events:
        if e["type"] == "substitution":
            on[e["sub_in"]] = e["t"]
            off[e["sub_out"]] = e["t"]
        if e.get("card") in ("red", "second_yellow") and e.get("player_id"):
            off[e["player_id"]] = e["t"]
        pid = e.get("player_id")
        if not pid:
            continue
        st = s[pid]
        if e["type"] in TOUCH_TYPES:
            st["touches"] += 1
        if e["type"] == "pass":
            st["passes"] += 1
            st["passes_ok"] += e["outcome"] == "success"
            st["difficulty_sum"] += e.get("difficulty", 0.0)
        if e.get("xt_added", 0) > 0:
            st["xt"] += e["xt_added"]
        if e["type"] == "shot":
            st["shots"] += 1
            st["xg"] += e.get("xg", 0)
            if e.get("shot_outcome") == "goal" and "own_goal" not in (e.get("tags") or []):
                st["goals"] += 1
        if e["type"] in ("tackle",):
            st["tackles"] += 1
        if e["type"] == "interception":
            st["interceptions"] += 1
        if e.get("card") == "yellow":
            st["yellow"] += 1
        if e.get("card") in ("red", "second_yellow"):
            st["red"] += 1
    # assists and key passes
    by_id = {e["id"]: e for e in events}
    for e in events:
        if e["type"] == "shot":
            prev = by_id.get(e.get("assist_event_id")) if e.get("assist_event_id") else None
            if prev and prev.get("player_id"):
                s[prev["player_id"]]["assists"] += 1
        if e["type"] == "pass" and e.get("outcome") == "success":
            pass
    for i, e in enumerate(events):
        if e["type"] == "shot" and i > 0:
            prev = events[i - 1]
            if prev["type"] == "pass" and prev.get("recipient_id") == e.get("player_id") and prev.get("player_id"):
                s[prev["player_id"]]["key_passes"] += 1
    out = []
    for pid, (p, _side) in players.items():
        if pid not in on:
            continue
        mins = max(0.0, (off.get(pid, end_t) - on[pid]) / 60)
        st = s[pid]
        passes = st["passes"]
        comp = st["passes_ok"] / passes if passes else 0.0
        rating = 6.2 + 0.9 * st["goals"] + 0.6 * st["assists"] + 1.6 * st["xt"] + 0.15 * st["key_passes"] \
            + 0.08 * (st["tackles"] + st["interceptions"]) + 0.35 * st["xg"] + (comp - 0.8) * 1.5 * min(passes, 40) / 40 \
            - 0.4 * st["yellow"] - 1.5 * st["red"]
        if mins < 20:
            rating = 6.0 + (rating - 6.0) * 0.6
        out.append({
            "player_id": pid, "name": p["name"], "team_id": p["team_id"], "shirt": p["shirt"], "position": p["position"],
            "minutes": round(mins), "touches": int(st["touches"]), "passes": int(passes), "pass_completion": round(comp, 3),
            "xt": round(st["xt"], 3), "xg": round(st["xg"], 2), "shots": int(st["shots"]), "goals": int(st["goals"]),
            "assists": int(st["assists"]), "key_passes": int(st["key_passes"]), "tackles": int(st["tackles"]),
            "interceptions": int(st["interceptions"]), "rating": round(max(3.0, min(10.0, rating)), 1),
            "avg_pass_difficulty": round(st["difficulty_sum"] / passes, 3) if passes else 0.0,
        })
    out.sort(key=lambda r: -r["rating"])
    return out


def shot_list(events: list[dict]) -> list[dict]:
    return [{"event_id": e["id"], "t": e["t"], "minute": e["minute"], "team_id": e["team_id"], "player_id": e.get("player_id"),
             "player_name": e.get("player_name"), "x": e["x"], "y": e["y"], "xg": e.get("xg", 0), "outcome": e.get("shot_outcome"),
             "body_part": e.get("body_part"), "situation": e.get("situation")} for e in events if e["type"] == "shot"]


def possession_chain(events: list[dict], event_id: str, max_events: int = 14) -> list[dict]:
    """Events of the possession that ends with `event_id` (the build-up to a shot or goal)."""
    idx = next((i for i, e in enumerate(events) if e["id"] == event_id), None)
    if idx is None:
        return []
    target = events[idx]
    chain = [target]
    for e in reversed(events[:idx]):
        if e["possession_id"] != target["possession_id"] or len(chain) >= max_events:
            break
        if e["type"] in ("pressure",):
            continue
        chain.append(e)
    return list(reversed(chain))


def euclid(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])
