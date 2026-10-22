"""Live win probability.

Pre-match scoring rates come from the goal model fitted to real international results (Elo gap -> expected goals).
In play, the remaining-time rates blend that prior with each side's observed xG rate, adjust for red cards, and
the final-score distribution is the current score plus two independent Poisson processes for the time left.
"""

from __future__ import annotations

import math

MATCH_SECONDS = 95 * 60
MAX_GOALS = 10


def _poisson(k: int, lam: float) -> float:
    return math.exp(-lam) * lam ** k / math.factorial(k)


def outcome_probs(lam_home: float, lam_away: float, score_home: int = 0, score_away: int = 0) -> dict:
    ph = [_poisson(k, max(lam_home, 1e-6)) for k in range(MAX_GOALS)]
    pa = [_poisson(k, max(lam_away, 1e-6)) for k in range(MAX_GOALS)]
    home = draw = away = 0.0
    for i, a in enumerate(ph):
        for j, b in enumerate(pa):
            p = a * b
            fh, fa = score_home + i, score_away + j
            if fh > fa:
                home += p
            elif fh == fa:
                draw += p
            else:
                away += p
    total = home + draw + away
    return {"home": home / total, "draw": draw / total, "away": away / total}


def live_rates(prior_home: float, prior_away: float, elapsed_s: float, xg_home: float, xg_away: float,
               reds_home: int = 0, reds_away: int = 0) -> tuple[float, float]:
    """Expected goals for the remaining time."""
    remaining = max(0.0, MATCH_SECONDS - elapsed_s) / MATCH_SECONDS
    played = max(elapsed_s / MATCH_SECONDS, 1e-6)
    w = min(0.55, played * 0.8)                       # trust in-game evidence more as the match goes on
    rate_h = (1 - w) * prior_home + w * (xg_home / played)
    rate_a = (1 - w) * prior_away + w * (xg_away / played)
    rate_h *= 0.72 ** reds_home * 1.18 ** reds_away
    rate_a *= 0.72 ** reds_away * 1.18 ** reds_home
    return rate_h * remaining, rate_a * remaining


def win_prob(prior_home: float, prior_away: float, elapsed_s: float, score_home: int, score_away: int,
             xg_home: float = 0.0, xg_away: float = 0.0, reds_home: int = 0, reds_away: int = 0) -> dict:
    lh, la = live_rates(prior_home, prior_away, elapsed_s, xg_home, xg_away, reds_home, reds_away)
    return {k: round(v, 4) for k, v in outcome_probs(lh, la, score_home, score_away).items()}
