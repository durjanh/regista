"""Expected threat (xT), learned from the event data by value iteration (Karun Singh's formulation).

The pitch is split into a 16 x 12 grid. For each cell we estimate how often the team in possession shoots or moves
the ball from it, where moves end up, and how often shots from it score. xT(cell) is the probability that possession
there leads to a goal within the next few actions. A pass or carry is credited with xT(end) - xT(start).
"""

from __future__ import annotations

import json
from pathlib import Path

from .geometry import LENGTH, WIDTH

NX, NY = 16, 12
MOVE_TYPES = {"pass", "carry", "dribble"}


def cell(x: float, y: float) -> tuple[int, int]:
    return min(NX - 1, max(0, int(x / LENGTH * NX))), min(NY - 1, max(0, int(y / WIDTH * NY)))


def fit_xt(matches: list[dict], iterations: int = 6) -> list[list[float]]:
    shots = [[0] * NY for _ in range(NX)]
    goals = [[0.0] * NY for _ in range(NX)]
    moves = [[0] * NY for _ in range(NX)]
    trans: dict[tuple[int, int], dict[tuple[int, int], int]] = {}
    for m in matches:
        for e in m["events"]:
            t = e["type"]
            if t == "shot" and e.get("situation") != "penalty":
                cx, cy = cell(e["x"], e["y"])
                shots[cx][cy] += 1
                goals[cx][cy] += e.get("xg", 0.0)  # xG is a lower-variance estimate of scoring probability
            elif t in MOVE_TYPES and "end_x" in e:
                cx, cy = cell(e["x"], e["y"])
                moves[cx][cy] += 1
                if e.get("outcome") == "success":
                    dst = cell(e["end_x"], e["end_y"])
                    trans.setdefault((cx, cy), {}).setdefault(dst, 0)
                    trans[(cx, cy)][dst] += 1
    xt = [[0.0] * NY for _ in range(NX)]
    for _ in range(iterations):
        new = [[0.0] * NY for _ in range(NX)]
        for i in range(NX):
            for j in range(NY):
                total = shots[i][j] + moves[i][j]
                if total == 0:
                    continue
                s = shots[i][j] / total
                g = goals[i][j] / shots[i][j] if shots[i][j] else 0.0
                mv = moves[i][j] / total
                outs = trans.get((i, j), {})
                n_moves = moves[i][j]
                exp = sum(c / n_moves * xt[a][b] for (a, b), c in outs.items()) if n_moves else 0.0
                new[i][j] = s * g + mv * exp
        xt = new
    return [[round(v, 5) for v in col] for col in xt]


def save(grid: list[list[float]], path: Path) -> None:
    path.write_text(json.dumps({"nx": NX, "ny": NY, "grid": grid}))


def load(path: Path) -> list[list[float]] | None:
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    return data["grid"] if data.get("nx") == NX and data.get("ny") == NY else None


def value(grid: list[list[float]], x: float, y: float) -> float:
    i, j = cell(x, y)
    return grid[i][j]


def annotate(events: list[dict], grid: list[list[float]]) -> None:
    """Add `xt_added` to successful passes, carries and dribbles."""
    for e in events:
        if e["type"] in MOVE_TYPES and e.get("outcome") == "success" and "end_x" in e:
            e["xt_added"] = round(value(grid, e["end_x"], e["end_y"]) - value(grid, e["x"], e["y"]), 4)
