"""Explainable expected-goals model.

A transparent logistic model: every shot's xG decomposes into additive logit contributions
(distance, angle, body part, assist type, situation, defenders in the shooting lane), which the UI
renders as a waterfall. Coefficients were fitted to standard public xG reference points
(a central penalty-spot shot ~0.25, six-yard box ~0.48, 20 m ~0.05, 25 m ~0.025).
"""

from __future__ import annotations

import math

from .geometry import distance_to_goal, goal_angle, in_shooting_lane

INTERCEPT = 0.78
ANGLE_COEF = 0.28
DIST_COEF = -0.1846
PENALTY_XG = 0.76

MODIFIERS = {
    "head": (-0.95, "Headed attempt"),
    "through_ball": (0.35, "Assisted by a through ball (defence bypassed)"),
    "cutback": (0.45, "Assisted by a cut-back (shooter facing goal)"),
    "cross": (-0.20, "From a cross (harder first-time contact)"),
    "counter": (0.25, "Counter-attack (defence not set)"),
    "set_piece": (-0.15, "Set-piece delivery (crowded box)"),
    "direct_free_kick": (-0.55, "Direct free kick over a wall"),
}
DEFENDER_COEF = -0.28
MAX_DEFENDER_PENALTY = -0.84


def _sigmoid(z: float) -> float:
    return 1.0 / (1.0 + math.exp(-z))


def xg_breakdown(x: float, y: float, *, body_part: str = "right_foot", situation: str = "open_play",
                 assist_type: str | None = None, defenders_in_lane: int = 0, direct_free_kick: bool = False) -> dict:
    """Return {'xg', 'base', 'factors': [{name, contribution, detail}]} for a shot from (x, y)."""
    if situation == "penalty":
        return {"xg": PENALTY_XG, "base": PENALTY_XG,
                "factors": [{"name": "Penalty", "contribution": 0.0, "detail": "Penalties are fixed at 0.76 xG"}]}

    dist = distance_to_goal(x, y)
    angle = goal_angle(x, y)
    factors = [
        {"name": "Distance", "contribution": round(DIST_COEF * dist, 3), "detail": f"{dist:.1f} m from goal"},
        {"name": "Angle", "contribution": round(ANGLE_COEF * angle, 3), "detail": f"{math.degrees(angle):.0f}° of goal visible"},
    ]
    z = INTERCEPT + DIST_COEF * dist + ANGLE_COEF * angle

    def add(key: str) -> None:
        nonlocal z
        coef, detail = MODIFIERS[key]
        z += coef
        factors.append({"name": key.replace("_", " ").capitalize(), "contribution": coef, "detail": detail})

    if body_part == "head":
        add("head")
    if direct_free_kick:
        add("direct_free_kick")
    elif assist_type in ("through_ball", "cutback", "cross"):
        add(assist_type)
    if situation == "counter":
        add("counter")
    elif situation == "set_piece" and not direct_free_kick:
        add("set_piece")
    if defenders_in_lane:
        pen = max(MAX_DEFENDER_PENALTY, DEFENDER_COEF * defenders_in_lane)
        z += pen
        factors.append({"name": "Defenders in lane", "contribution": round(pen, 3),
                        "detail": f"{defenders_in_lane} defender{'s' if defenders_in_lane != 1 else ''} between ball and goal"})

    base = _sigmoid(INTERCEPT)
    return {"xg": round(min(0.97, max(0.005, _sigmoid(z))), 3), "base": round(base, 3), "factors": factors}


def defenders_in_lane(shot_x: float, shot_y: float, freeze_frame: list[dict] | None, shooter_team: str) -> int:
    if not freeze_frame:
        return 0
    return sum(1 for p in freeze_frame
               if p["team_id"] != shooter_team and in_shooting_lane(p["x"], p["y"], shot_x, shot_y)
               and not p.get("gk"))


def shot_xg(event: dict, assist_type: str | None = None) -> dict:
    dfk = "direct_free_kick" in (event.get("tags") or [])
    n_def = defenders_in_lane(event["x"], event["y"], event.get("freeze_frame"), event["team_id"])
    return xg_breakdown(event["x"], event["y"], body_part=event.get("body_part", "right_foot"),
                        situation=event.get("situation", "open_play"), assist_type=assist_type,
                        defenders_in_lane=n_def, direct_free_kick=dfk)
