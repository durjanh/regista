"""Tactical analysis: formation detection, shape changes, pass networks, pressing and channel usage.

Formation detection uses only the event data (average positions of each player's touches); it never reads the
simulator's ground truth. The evals compare detected shape changes with that truth to measure accuracy.
"""

from __future__ import annotations

from collections import defaultdict

from ..forge.teams import FORMATIONS
from .geometry import WIDTH
from .stats import DEFENSIVE_ACTIONS

POSITION_EVENTS = {"pass", "carry", "dribble", "shot", "tackle", "interception", "clearance", "recovery", "pressure", "throw_in"}


def line_sizes(formation: str) -> list[int]:
    return [int(p) for p in formation.split("-")]


def _standardise(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    n = len(points)
    mx = sum(p[0] for p in points) / n
    my = sum(p[1] for p in points) / n
    sx = (sum((p[0] - mx) ** 2 for p in points) / n) ** 0.5 or 1.0
    sy = (sum((p[1] - my) ** 2 for p in points) / n) ** 0.5 or 1.0
    return [((p[0] - mx) / sx, (p[1] - my) / sy) for p in points]


def _hungarian(cost: list[list[float]]) -> float:
    """Minimum-cost perfect assignment (square matrix), O(n^3)."""
    n = len(cost)
    u, v, p, way = [0.0] * (n + 1), [0.0] * (n + 1), [0] * (n + 1), [0] * (n + 1)
    for i in range(1, n + 1):
        p[0], j0 = i, 0
        minv, used = [float("inf")] * (n + 1), [False] * (n + 1)
        while True:
            used[j0] = True
            i0, delta, j1 = p[j0], float("inf"), 0
            for j in range(1, n + 1):
                if not used[j]:
                    cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
                    if cur < minv[j]:
                        minv[j], way[j] = cur, j0
                    if minv[j] < delta:
                        delta, j1 = minv[j], j
            for j in range(n + 1):
                if used[j]:
                    u[p[j]] += delta
                    v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        while True:
            j1 = way[j0]
            p[j0] = p[j1]
            j0 = j1
            if j0 == 0:
                break
    return sum(cost[p[j] - 1][j - 1] for j in range(1, n + 1))


TEMPLATES = {name: _standardise([(x, y) for (pos, x, y) in slots if pos != "GK"]) for name, slots in FORMATIONS.items()}


def avg_positions(events: list[dict], team_id: str, t0: float = 0, t1: float = 1e9, min_touches: int = 6) -> dict[str, tuple[float, float, int]]:
    acc: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0, 0])
    for e in events:
        if e["team_id"] != team_id or not e.get("player_id") or not (t0 <= e["t"] < t1) or e["type"] not in POSITION_EVENTS:
            continue
        a = acc[e["player_id"]]
        a[0] += e["x"]
        a[1] += e["y"]
        a[2] += 1
        if e["type"] == "pass" and e.get("outcome") == "success" and e.get("recipient_id"):
            r = acc[e["recipient_id"]]
            r[0] += e["end_x"]
            r[1] += e["end_y"]
            r[2] += 1
    return {pid: (a[0] / a[2], a[1] / a[2], int(a[2])) for pid, a in acc.items() if a[2] >= min_touches}


def detect_formation(points: list[tuple[float, float]]) -> tuple[str, float]:
    """Match the outfield players' average positions to each formation template (2-D, standardised, optimal
    one-to-one assignment). Width matters as much as depth: full-backs are wide, holding midfielders central."""
    n = len(points)
    if n < 8:
        return ("unknown", 0.0)
    pts = _standardise(points)
    scored = []
    for name, tpl in TEMPLATES.items():
        if len(tpl) != n:
            continue
        cost = [[(a[0] - b[0]) ** 2 + 0.8 * (a[1] - b[1]) ** 2 for b in tpl] for a in pts]
        scored.append((_hungarian(cost) / n, name))
    if not scored:
        return ("unknown", 0.0)
    scored.sort()
    best, second = scored[0], (scored[1][0] if len(scored) > 1 else scored[0][0] * 2)
    confidence = max(0.0, min(1.0, (second - best[0]) / max(second, 1e-6) * 3))
    return best[1], round(confidence, 2)


def outfield_on_pitch(events: list[dict], meta_team: dict, t: float) -> set[str]:
    on = {p["player_id"] for p in meta_team["players"] if p["starter"] and p["position"] != "GK"}
    gk = {p["player_id"] for p in meta_team["players"] if p["position"] == "GK"}
    for e in events:
        if e["t"] > t:
            break
        if e["type"] == "substitution" and e["team_id"] == meta_team["team_id"]:
            on.discard(e["sub_out"])
            if e["sub_in"] not in gk:
                on.add(e["sub_in"])
        if e.get("card") in ("red", "second_yellow") and e["team_id"] == meta_team["team_id"]:
            on.discard(e.get("player_id"))
    return on


def formation_in_window(events: list[dict], meta_team: dict, t0: float, t1: float, at: float | None = None) -> tuple[str, float]:
    """Shape of the players on the pitch at `at` (default: window midpoint), from their touches inside [t0, t1)."""
    on = outfield_on_pitch(events, meta_team, at if at is not None else (t0 + t1) / 2)
    pos = avg_positions(events, meta_team["team_id"], t0, t1, min_touches=2)
    pts = [(pos[p][0], pos[p][1]) for p in on if p in pos]
    if len(pts) != len(on):
        return ("unknown", 0.0)
    return detect_formation(pts)


MIN_SHIFT_CONFIDENCE = 0.6


def detect_shifts(events: list[dict], meta_team: dict, upto_t: float, window: float = 18 * 60) -> list[dict]:
    """Compare the shape just before and just after each substitution or red card for this team.
    A change is reported only when both windows are confident and the back line or the line count changes."""
    tid = meta_team["team_id"]
    triggers = [e for e in events if e["team_id"] == tid and e["t"] <= upto_t and
                (e["type"] == "substitution" or e.get("card") in ("red", "second_yellow"))]
    shifts: list[dict] = []
    current = None
    for e in triggers:
        if e["t"] + 8 * 60 > upto_t:
            continue
        before, cb = formation_in_window(events, meta_team, max(0, e["t"] - window), e["t"], at=e["t"] - 1)
        after, ca = formation_in_window(events, meta_team, e["t"] + 20, min(upto_t, e["t"] + window), at=e["t"] + 1)
        if "unknown" in (before, after):
            continue
        if current and before != current["to"] and cb < 0.6:
            before = current["to"]          # trust the last confident reading over a weak one
        if before == after or min(cb, ca) < MIN_SHIFT_CONFIDENCE:
            continue
        if shifts and e["t"] - shifts[-1]["t"] < 10 * 60:
            continue
        current = {"minute": e["minute"], "t": e["t"], "from": before, "to": after, "trigger_event_id": e["id"],
                   "confidence": round(min(cb, ca), 2), "explanation": _shift_explanation(before, after, e)}
        shifts.append(current)
    return shifts


def _shift_explanation(before: str, after: str, trigger: dict) -> str:
    b, a = line_sizes(before), line_sizes(after)
    cause = "after the red card" if trigger.get("card") else "after the substitution"
    if a[0] > b[0]:
        return f"Back line grew from {b[0]} to {a[0]} {cause}: average positions show an extra defender dropping in."
    if a[0] < b[0]:
        return f"Back line went from {b[0]} to {a[0]} {cause}, pushing a defender higher to add attacking numbers."
    if a[-1] > b[-1]:
        return f"More bodies in the front line ({b[-1]} to {a[-1]}) {cause}: the team went for it."
    return f"Midfield re-shaped from {before} to {after} {cause}."


def pass_network(events: list[dict], meta_team: dict, t0: float = 0, t1: float = 1e9) -> dict:
    tid = meta_team["team_id"]
    names = {p["player_id"]: p for p in meta_team["players"]}
    pos = avg_positions(events, tid, t0, t1, min_touches=5)
    edges: dict[tuple[str, str], int] = defaultdict(int)
    for e in events:
        if e["team_id"] == tid and e["type"] == "pass" and e.get("outcome") == "success" and t0 <= e["t"] < t1 and e.get("recipient_id"):
            a, b = sorted((e["player_id"], e["recipient_id"]))
            edges[(a, b)] += 1
    nodes = [{"player_id": pid, "name": names[pid]["name"], "shirt": names[pid]["shirt"], "x": round(x, 1), "y": round(y, 1), "touches": n}
             for pid, (x, y, n) in pos.items() if pid in names]
    keep = {n["player_id"] for n in nodes}
    return {"team_id": tid, "nodes": nodes,
            "edges": [{"source": a, "target": b, "count": c} for (a, b), c in edges.items() if c >= 3 and a in keep and b in keep]}


def ppda_windows(events: list[dict], team_id: str, opp_id: str, upto_t: float, period_starts: list[float]) -> list[dict]:
    out = []
    p2 = period_starts[1] if len(period_starts) > 1 else 2700
    windows = [(0, 15), (15, 30), (30, 45), (45, 60), (60, 75), (75, 90)]
    for a, b in windows:
        t0 = a * 60 if a < 45 else p2 + (a - 45) * 60
        t1 = (b * 60 if b <= 45 else p2 + (b - 45) * 60) if b != 45 else p2
        if b == 90:
            t1 = 1e9
        if t0 > upto_t:
            break
        opp_build = sum(1 for e in events if e["team_id"] == opp_id and e["type"] == "pass" and e["x"] < 63 and t0 <= e["t"] < t1)
        acts = sum(1 for e in events if e["team_id"] == team_id and e["type"] in DEFENSIVE_ACTIONS and e["x"] > 42 and t0 <= e["t"] < t1)
        out.append({"window": f"{a}-{b}", "value": round(opp_build / acts, 1) if acts else 0.0})
    return out


def channels(events: list[dict], team_id: str) -> dict:
    c = {"left": 0, "center": 0, "right": 0}
    for e in events:
        if e["team_id"] == team_id and e["type"] in ("pass", "carry") and e.get("outcome") == "success" and e["x"] < 70 <= e.get("end_x", 0):
            y = e["end_y"]
            c["right" if y < WIDTH / 3 else "left" if y > 2 * WIDTH / 3 else "center"] += 1
    total = sum(c.values()) or 1
    return {k: round(v / total, 3) for k, v in c.items()}


def avg_line_height(events: list[dict], meta_team: dict) -> float:
    defenders = {p["player_id"] for p in meta_team["players"] if p["position"] in ("CB", "RB", "LB", "RWB", "LWB")}
    xs = [e["x"] for e in events if e.get("player_id") in defenders and e["type"] in POSITION_EVENTS]
    return round(sum(xs) / len(xs), 1) if xs else 0.0


def team_tactics(events: list[dict], meta: dict, side: str, upto_t: float) -> dict:
    team = meta[side]
    other = meta["away" if side == "home" else "home"]
    last_change = max((e["t"] for e in events if e["team_id"] == team["team_id"] and e["t"] <= upto_t and
                       (e["type"] == "substitution" or e.get("card") in ("red", "second_yellow"))), default=0.0)
    t0 = max(0.0, upto_t - 25 * 60, last_change if upto_t - last_change > 8 * 60 else 0.0)
    formation = formation_in_window(events, team, t0, upto_t + 1, at=upto_t)
    if formation[0] == "unknown":
        formation = (team["formation"], 0.3)
    return {
        "team_id": team["team_id"],
        "formation": {"detected": formation[0], "confidence": formation[1]},
        "shifts": [{k: v for k, v in s.items() if k != "t"} for s in detect_shifts(events, team, upto_t)],
        "ppda": ppda_windows(events, team["team_id"], other["team_id"], upto_t, meta.get("period_starts", [0, 2700])),
        "channels": channels(events, team["team_id"]),
        "pass_network": pass_network(events, team),
        "avg_line_height": avg_line_height(events, team),
    }
