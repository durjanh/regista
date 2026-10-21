"""Formations, tactical styles and team/player profiles used by the match engine.

Teams are real national teams from the reference dataset (see forge.reference). Their strength comes
from Elo ratings computed over every result since 1872; their tactical archetype is inferred from
that strength relative to the opponent. Formations are a modelling assumption (the dataset has no
line-ups), so the UI labels them "model shape".
"""

from __future__ import annotations

from dataclasses import dataclass, field

PITCH_LENGTH = 105.0
PITCH_WIDTH = 68.0

# Slot templates in the team's attacking frame (x towards the opponent goal, y = 0 on the right touchline).
# Lines are spaced so consecutive slots inside a line sit within ~8 m and lines sit at least ~12 m apart,
# which keeps formations recoverable from average positions (see analytics.tactics.detect_formation).
FORMATIONS: dict[str, list[tuple[str, float, float]]] = {
    "4-3-3": [("GK", 5, 34), ("RB", 30, 8), ("CB", 24, 25), ("CB", 24, 43), ("LB", 30, 60),
              ("DM", 46, 34), ("CM", 53, 20), ("CM", 53, 48), ("RW", 76, 10), ("ST", 82, 34), ("LW", 76, 58)],
    "4-2-3-1": [("GK", 5, 34), ("RB", 29, 8), ("CB", 23, 25), ("CB", 23, 43), ("LB", 29, 60),
                ("DM", 44, 26), ("DM", 44, 42), ("RW", 67, 11), ("AM", 64, 34), ("LW", 67, 57), ("ST", 80, 34)],
    "4-4-2": [("GK", 5, 34), ("RB", 28, 8), ("CB", 23, 25), ("CB", 23, 43), ("LB", 28, 60),
              ("RW", 56, 9), ("CM", 50, 27), ("CM", 50, 41), ("LW", 56, 59), ("ST", 80, 28), ("ST", 80, 40)],
    "3-5-2": [("GK", 5, 34), ("CB", 24, 17), ("CB", 22, 34), ("CB", 24, 51), ("RWB", 50, 6),
              ("DM", 45, 34), ("CM", 53, 23), ("CM", 53, 45), ("LWB", 50, 62), ("ST", 80, 28), ("ST", 80, 40)],
    "3-4-3": [("GK", 5, 34), ("CB", 24, 17), ("CB", 22, 34), ("CB", 24, 51), ("RWB", 52, 6),
              ("CM", 48, 27), ("CM", 48, 41), ("LWB", 52, 62), ("RW", 76, 12), ("ST", 82, 34), ("LW", 76, 56)],
    "5-3-2": [("GK", 5, 34), ("RWB", 28, 6), ("CB", 22, 20), ("CB", 20, 34), ("CB", 22, 48),
              ("LWB", 28, 62), ("CM", 44, 22), ("DM", 40, 34), ("CM", 44, 46), ("ST", 72, 28), ("ST", 72, 40)],
    "3-4-2-1": [("GK", 5, 34), ("CB", 24, 17), ("CB", 22, 34), ("CB", 24, 51), ("RWB", 50, 6),
                ("CM", 46, 27), ("CM", 46, 41), ("LWB", 50, 62), ("AM", 66, 22), ("AM", 66, 46), ("ST", 80, 34)],
    "4-2-4": [("GK", 5, 34), ("RB", 34, 8), ("CB", 28, 25), ("CB", 28, 43), ("LB", 34, 60),
              ("CM", 50, 27), ("CM", 50, 41), ("RW", 78, 9), ("ST", 84, 28), ("ST", 84, 40), ("LW", 78, 59)],
    # Ten-man shapes used after a red card.
    "4-4-1": [("GK", 5, 34), ("RB", 26, 8), ("CB", 21, 25), ("CB", 21, 43), ("LB", 26, 60),
              ("RW", 48, 9), ("CM", 44, 27), ("CM", 44, 41), ("LW", 48, 59), ("ST", 74, 34)],
    "5-3-1": [("GK", 5, 34), ("RWB", 26, 6), ("CB", 20, 20), ("CB", 18, 34), ("CB", 20, 48),
              ("LWB", 26, 62), ("CM", 40, 22), ("DM", 37, 34), ("CM", 40, 46), ("ST", 70, 34)],
}

# How a manager chasing the game reshapes, and how a team protecting a lead does.
ATTACKING_SHIFT = {"4-3-3": "3-4-3", "4-2-3-1": "4-2-4", "4-4-2": "4-2-4", "3-5-2": "3-4-3",
                   "5-3-2": "3-5-2", "3-4-2-1": "3-4-3", "3-4-3": "4-2-4"}
DEFENSIVE_SHIFT = {"4-3-3": "5-3-2", "4-2-3-1": "5-3-2", "4-4-2": "5-3-2", "3-4-3": "5-3-2",
                   "3-4-2-1": "5-3-2", "3-5-2": "5-3-2", "4-2-4": "4-4-2"}
TEN_MAN_SHAPE = {"4-3-3": "4-4-1", "4-2-3-1": "4-4-1", "4-4-2": "4-4-1", "4-2-4": "4-4-1",
                 "3-5-2": "5-3-1", "3-4-3": "5-3-1", "5-3-2": "5-3-1", "3-4-2-1": "5-3-1"}

POSITION_FAMILY = {"GK": "GK", "RB": "DEF", "CB": "DEF", "LB": "DEF", "RWB": "WB", "LWB": "WB",
                   "DM": "MID", "CM": "MID", "AM": "AM", "RW": "WIDE", "LW": "WIDE", "ST": "FWD"}

# Order in which slots are filled from the most to the least attack-minded player.
ATTACK_ORDER = ["ST", "LW", "RW", "AM", "CM", "LWB", "RWB", "DM", "LB", "RB", "CB", "GK"]
BENCH_POSITIONS = ["GK", "CB", "RB", "CM", "AM", "LW", "ST"]


@dataclass
class Style:
    label: str
    possession: float   # appetite for keeping the ball (0..1)
    directness: float   # preference for forward/long passes (0..1)
    press: float        # out-of-possession pressing intensity (0..1)
    width: float        # use of wide channels (0..1)
    tempo: float        # speed of circulation (0..1)
    line_height: float  # defensive line height (0..1)
    crossing: float     # crossing appetite from wide areas (0..1)

    def to_dict(self) -> dict:
        return {"label": self.label, "possession": round(self.possession, 2), "directness": round(self.directness, 2),
                "press": round(self.press, 2), "width": round(self.width, 2)}


# Archetypes keyed by relative strength. Inferred from Elo gap, not invented per team.
ARCHETYPES = {
    "dominant": ("Dominant possession", "4-3-3", Style("Dominant possession", 0.82, 0.32, 0.78, 0.60, 0.68, 0.78, 0.38)),
    "controlled": ("Controlled build-up", "4-2-3-1", Style("Controlled build-up", 0.68, 0.42, 0.62, 0.55, 0.60, 0.65, 0.42)),
    "balanced": ("Balanced mid-block", "4-2-3-1", Style("Balanced mid-block", 0.52, 0.52, 0.52, 0.55, 0.58, 0.52, 0.48)),
    "counter": ("Compact counter-attack", "4-2-3-1", Style("Compact counter-attack", 0.40, 0.68, 0.42, 0.50, 0.72, 0.40, 0.52)),
    "low_block": ("Low block and transitions", "5-3-2", Style("Low block and transitions", 0.32, 0.75, 0.28, 0.45, 0.55, 0.25, 0.55)),
}


def archetype_for(elo: float, opponent_elo: float, home: bool, neutral: bool) -> str:
    gap = elo - opponent_elo + (0 if neutral else (60 if home else -60))
    if gap > 220:
        return "dominant"
    if gap > 80:
        return "controlled"
    if gap > -80:
        return "balanced"
    if gap > -220:
        return "counter"
    return "low_block"


@dataclass
class PlayerProfile:
    player_id: str
    team_id: str
    name: str
    shirt: int
    position: str
    starter: bool
    passing: float
    finishing: float
    dribbling: float
    defending: float
    stamina: float
    name_source: str = "dataset"        # "dataset" | "placeholder"
    goals_in_window: int = 0
    assists_in_window: int = 0
    player_key: str = ""                 # stable across matches: "<team_id>:<name-slug>" or "<team_id>:no-<shirt>"

    def to_dict(self) -> dict:
        return {"player_id": self.player_id, "team_id": self.team_id, "name": self.name, "shirt": self.shirt,
                "position": self.position, "starter": self.starter, "name_source": self.name_source, "player_key": self.player_key}


@dataclass
class TeamProfile:
    team_id: str
    name: str
    short: str
    elo: float
    attack: float                 # 0..1, from Elo and recent scoring rate
    defence: float                # 0..1, from Elo and recent conceding rate
    formation: str
    style: Style
    colors: dict
    squad: list[PlayerProfile] = field(default_factory=list)
    manager: str = "Not recorded"
    city: str = ""
    archetype: str = "balanced"
    seed: int = 0

    def payload(self, formation: str | None = None) -> dict:
        return {
            "team_id": self.team_id, "name": self.name, "short": self.short, "colors": self.colors,
            "city": self.city, "manager": self.manager, "formation": formation or self.formation,
            "style": self.style.to_dict(), "players": [p.to_dict() for p in self.squad], "elo": round(self.elo),
        }

    def ref(self) -> dict:
        return {"team_id": self.team_id, "name": self.name, "short": self.short, "colors": self.colors}
