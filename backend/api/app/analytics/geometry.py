"""Pitch geometry helpers. All coordinates are metres in the acting team's attacking frame."""

from __future__ import annotations

import math

LENGTH = 105.0
WIDTH = 68.0
GOAL_X = LENGTH
GOAL_Y = WIDTH / 2
GOAL_WIDTH = 7.32
BOX_X = LENGTH - 16.5
BOX_Y_MIN = (WIDTH - 40.32) / 2
BOX_Y_MAX = WIDTH - BOX_Y_MIN


def clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else hi if v > hi else v


def mirror(x: float, y: float) -> tuple[float, float]:
    """Convert a point between the two teams' attacking frames."""
    return LENGTH - x, WIDTH - y


def distance_to_goal(x: float, y: float) -> float:
    return math.hypot(GOAL_X - x, GOAL_Y - y)


def goal_angle(x: float, y: float) -> float:
    """Visible goal-mouth angle in radians from (x, y)."""
    dx = max(GOAL_X - x, 0.1)
    dy = abs(GOAL_Y - y)
    half = GOAL_WIDTH / 2
    a = math.atan2(GOAL_WIDTH * dx, dx * dx + dy * dy - half * half)
    return a if a >= 0 else a + math.pi


def in_box(x: float, y: float) -> bool:
    return x >= BOX_X and BOX_Y_MIN <= y <= BOX_Y_MAX


def third(x: float) -> str:
    return "defensive" if x < 35 else "middle" if x < 70 else "final"


def channel(y: float) -> str:
    """Channel in the acting team's frame (y = 0 is their right touchline)."""
    return "right" if y < WIDTH / 3 else "left" if y > 2 * WIDTH / 3 else "center"


def point_segment_distance(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    abx, aby = bx - ax, by - ay
    denom = abx * abx + aby * aby
    if denom == 0:
        return math.hypot(px - ax, py - ay)
    t = clamp(((px - ax) * abx + (py - ay) * aby) / denom, 0.0, 1.0)
    return math.hypot(px - (ax + t * abx), py - (ay + t * aby))


def in_shooting_lane(px: float, py: float, sx: float, sy: float) -> bool:
    """True when (px, py) sits inside the triangle between the shooter and the goal posts."""
    if px <= sx or px > GOAL_X:
        return False
    post_low, post_high = GOAL_Y - GOAL_WIDTH / 2, GOAL_Y + GOAL_WIDTH / 2
    frac = (px - sx) / max(GOAL_X - sx, 0.1)
    low = sy + (post_low - sy) * frac - 0.6
    high = sy + (post_high - sy) * frac + 0.6
    return low <= py <= high
