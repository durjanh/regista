"""Player tendency profiles for the synthetic engine (MODEL data, clearly labelled as such in the product).

The results dataset records who scored, when and how (penalty / own goal), but not which side a striker favours,
where a penalty taker places the ball, which way a keeper dives or how far a player runs. To make scouting and the
dugout realistic, every player gets a stable tendency profile seeded from their identity. The engine plays these
tendencies out match after match; the scouting analytics then rediscover them from the events alone, and the evals
measure how accurately (the engine knows the truth). In production the same analytics run on a licensed event feed.
"""

from __future__ import annotations

import csv
import hashlib
import random
import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .teams import POSITION_FAMILY

KNOWN_TRAITS_FILE = Path(__file__).resolve().parents[4] / "data" / "reference" / "player_traits.csv"

SIDES = ("left", "center", "right")


@dataclass(frozen=True)
class Traits:
    foot: str                     # "right" | "left" | "both"
    shot_channel: dict            # preference for shooting from his team's left / centre / right channel
    penalty: dict                 # placement, taker's view
    gk_dive: dict                 # keepers: dive direction, taker's view
    work_rate: float              # distance multiplier
    press: float                  # pressing involvement multiplier
    aerial: float                 # aerial threat multiplier
    long_pass: float              # appetite for long passes
    pace_kmh: float               # top speed
    stamina: float                # resistance to late-game decline (higher = fresher)
    long_shot: float = 1.0        # appetite for shooting from outside the box

    def to_dict(self) -> dict:
        return {"foot": self.foot, "shot_channel": self.shot_channel, "penalty": self.penalty, "gk_dive": self.gk_dive,
                "work_rate": self.work_rate, "press": self.press, "aerial": self.aerial, "long_pass": self.long_pass,
                "pace_kmh": self.pace_kmh, "stamina": self.stamina, "long_shot": self.long_shot}


def _slug(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


@lru_cache(maxsize=1)
def known_traits() -> dict[str, dict]:
    """Publicly known preferred foot plus aerial / long-shot profile for prominent players (curated)."""
    out: dict[str, dict] = {}
    if KNOWN_TRAITS_FILE.exists():
        for r in csv.DictReader(open(KNOWN_TRAITS_FILE, encoding="utf-8")):
            out[f"{_slug(r['team'])}:{_slug(r['name'])}"] = {
                "foot": r["foot"], "aerial": float(r["aerial"]) if r.get("aerial") else None,
                "long_shot": float(r["long_shot"]) if r.get("long_shot") else None}
    return out


def _rng(key: str) -> random.Random:
    return random.Random(int(hashlib.sha1(key.encode()).hexdigest()[:12], 16))


def _norm(d: dict) -> dict:
    total = sum(d.values()) or 1.0
    return {k: round(v / total, 3) for k, v in d.items()}


def traits_for(player_key: str, position: str) -> Traits:
    r = _rng(player_key)
    fam = POSITION_FAMILY.get(position, "MID")
    known = known_traits().get(player_key, {})
    roll = r.random()
    foot = known.get("foot") or ("left" if roll < 0.22 else "both" if roll > 0.93 else "right")
    # shooting channel follows position and foot: inverted wingers cut inside onto their stronger foot
    if position in ("RW", "RWB", "RB"):
        inverted = foot == "left"
        ch = {"right": r.uniform(0.45, 0.62) if inverted else r.uniform(0.3, 0.45), "center": r.uniform(0.3, 0.45),
              "left": r.uniform(0.02, 0.08)}
    elif position in ("LW", "LWB", "LB"):
        inverted = foot == "right"
        ch = {"left": r.uniform(0.45, 0.62) if inverted else r.uniform(0.3, 0.45), "center": r.uniform(0.3, 0.45),
              "right": r.uniform(0.02, 0.08)}
    elif fam == "FWD":
        lean = "left" if foot == "left" else "right" if foot == "right" else r.choice(["left", "right"])
        ch = {"center": r.uniform(0.5, 0.7), lean: r.uniform(0.2, 0.35), ("right" if lean == "left" else "left"): r.uniform(0.05, 0.15)}
    else:
        lean = r.choice(["left", "right"])
        ch = {"center": r.uniform(0.4, 0.6), lean: r.uniform(0.2, 0.35), ("right" if lean == "left" else "left"): r.uniform(0.1, 0.25)}
    # penalties: most takers favour their natural side (right-footers: their left), some go the other way or down the middle
    natural = "left" if foot != "left" else "right"
    other = "right" if natural == "left" else "left"
    fav = natural if r.random() < 0.68 else other
    pen = {fav: r.uniform(0.5, 0.72), ("right" if fav == "left" else "left"): r.uniform(0.18, 0.38), "center": r.uniform(0.04, 0.18)}
    dive_fav = r.choice(["left", "right"])
    dive = {dive_fav: r.uniform(0.5, 0.68), ("right" if dive_fav == "left" else "left"): r.uniform(0.28, 0.45), "center": r.uniform(0.02, 0.08)}
    base_work = {"GK": 0.95, "DEF": 0.97, "WB": 1.04, "MID": 1.03, "AM": 1.0, "WIDE": 1.0, "FWD": 0.97}[fam]
    base_aerial = {"GK": 0.5, "DEF": 1.3, "WB": 0.7, "MID": 0.8, "AM": 0.55, "WIDE": 0.45, "FWD": 1.1}[fam]
    base_long = {"GK": 0.1, "DEF": 0.55, "WB": 0.8, "MID": 1.2, "AM": 1.25, "WIDE": 1.0, "FWD": 0.75}[fam]
    return Traits(
        foot=foot,
        shot_channel=_norm(ch),
        penalty=_norm(pen),
        gk_dive=_norm(dive),
        work_rate=round(base_work * r.uniform(0.9, 1.1), 3),
        press=round(r.uniform(0.65, 1.4), 3),
        aerial=round(known.get("aerial") or base_aerial * r.uniform(0.75, 1.3), 3),
        long_pass=round(r.uniform(0.7, 1.35) * (1.15 if fam in ("DEF", "GK") else 1.0), 3),
        pace_kmh=round(r.uniform(29.0, 35.5) - (1.5 if fam in ("DEF", "GK") else 0.0), 1),
        stamina=round(r.uniform(0.85, 1.15), 3),
        long_shot=round(known.get("long_shot") or base_long * r.uniform(0.8, 1.25), 3),
    )


def sample(dist: dict, r: random.Random) -> str:
    x = r.random()
    acc = 0.0
    for k in SIDES:
        acc += dist.get(k, 0.0)
        if x <= acc:
            return k
    return "center"


# Altitude (metres) of host cities in the reference data where it matters for fatigue. Public geographic facts.
CITY_ALTITUDE = {
    "Mexico City": 2240, "Zapopan": 1566, "Guadalajara": 1566, "La Paz": 3640, "Quito": 2850, "Bogotá": 2640,
    "Addis Ababa": 2355, "Toluca": 2667, "Puebla": 2135, "Johannesburg": 1753, "Pretoria": 1339, "Nairobi": 1795,
    "Guadalupe": 540, "Munich": 519, "Atlanta": 320, "Kansas City": 270, "Stuttgart": 245,
}


def venue_info(city: str, country: str) -> dict:
    alt = CITY_ALTITUDE.get(city)
    info: dict = {"city": city}
    if alt is not None:
        info["altitude_m"] = alt
        if alt >= 1500:
            info["note"] = f"{city} sits at {alt:,} m: thinner air means visiting players tire earlier and the ball travels further."
    return info


def altitude_fatigue(altitude_m: int | None, acclimatised: bool) -> float:
    if not altitude_m or acclimatised:
        return 1.0
    if altitude_m >= 2000:
        return 1.6
    if altitude_m >= 1500:
        return 1.3
    return 1.0
