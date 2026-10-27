"""Regista match engine: a possession-chain simulator that produces football-realistic event data.

Design goals (they are what makes the synthetic data useful, not just plausible):
- Tactical identity: formations, pressing, directness, width, tempo and line height shape every action.
- Game state: trailing teams take more risk late on, leaders sit deeper, fatigue raises error rates,
  red cards and tactical substitutions change the shape.
- Spatial truth: every player's position is modelled (a ball-oriented block model), so shots carry a
  freeze frame of all 22 players and xG can explain defenders in the shooting lane.
- Ground truth: the simulator records what it did (formation changes, red cards, scenario) in
  `truth`, so our analytics and agents can be evaluated against known answers.
- Calibration: goal rates, goal timing, penalty share and scorelines are tuned against 49k real
  international results (see forge.calibration); event volumes against typical top-flight ranges.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

from ..analytics.geometry import BOX_X, LENGTH, WIDTH, channel, clamp, distance_to_goal, in_box, mirror
from ..analytics.xg import shot_xg
from .teams import (
    ATTACKING_SHIFT,
    DEFENSIVE_SHIFT,
    FORMATIONS,
    POSITION_FAMILY,
    TEN_MAN_SHAPE,
    PlayerProfile,
    TeamProfile,
)
from .traits import altitude_fatigue, sample, traits_for

SCENARIOS = ("balanced", "late_drama", "comeback", "red_card", "derby", "tactical_chess", "goal_fest", "underdog")

SCENARIO_LABELS = {
    "balanced": "An even contest",
    "late_drama": "Late drama",
    "comeback": "The comeback",
    "red_card": "Down to ten",
    "derby": "A fiery derby",
    "tactical_chess": "Tactical chess",
    "goal_fest": "Goal fest",
    "underdog": "Giant-killing",
}

FIRST_HALF = 45 * 60
# How often each family receives passes relative to its position on the pitch (strikers get far fewer touches).
# Who wins the ball back: defensive actions follow role, not just proximity (strikers rarely intercept).
DEFEND_WEIGHT = {"FWD": 0.3, "WIDE": 0.55, "AM": 0.65, "MID": 1.0, "WB": 1.1, "DEF": 1.5, "GK": 1.0}
RECEIVE_WEIGHT = {"FWD": 0.36, "WIDE": 0.75, "AM": 0.9, "MID": 1.1, "DEF": 1.9, "WB": 1.1, "GK": 1.0}


@dataclass
class TeamState:
    club: TeamProfile
    squad: list[PlayerProfile]
    formation: str
    side: str                                   # "home" | "away"
    slots: list[tuple[str, float, float]] = field(default_factory=list)
    on_pitch: list[str] = field(default_factory=list)     # player ids aligned with slots
    bench: list[str] = field(default_factory=list)
    yellow: set[str] = field(default_factory=set)
    sent_off: set[str] = field(default_factory=set)
    subs_used: int = 0
    entered_at: dict[str, float] = field(default_factory=dict)
    attack: float = 0.7
    defence: float = 0.7
    risk: float = 0.0                           # dynamic, game-state driven
    press_boost: float = 0.0
    line_boost: float = 0.0

    def __post_init__(self) -> None:
        self.by_id = {p.player_id: p for p in self.squad}
        self.traits = {p.player_id: traits_for(p.player_key or p.player_id, p.position) for p in self.squad}
        self.altitude_factor = 1.0
        self.slots = list(FORMATIONS[self.formation])
        self.on_pitch = [p.player_id for p in self.squad if p.starter][: len(self.slots)]
        self.bench = [p.player_id for p in self.squad if not p.starter]
        self.entered_at = {pid: 0.0 for pid in self.on_pitch}

    @property
    def team_id(self) -> str:
        return self.club.team_id

    @property
    def style(self):
        return self.club.style

    plant_press: float = 0.0          # persistent changes from planted scenario scripts (hidden truth)
    plant_line: float = 0.0

    def press(self) -> float:
        return clamp(self.style.press + self.press_boost + self.plant_press, 0.05, 1.0)

    def line(self) -> float:
        return clamp(self.style.line_height + self.line_boost + self.plant_line, 0.05, 1.0)

    def directness(self) -> float:
        return clamp(self.style.directness + 0.35 * self.risk, 0.05, 1.0)

    def gk(self) -> str:
        return self.on_pitch[0]

    def slot_of(self, pid: str) -> tuple[str, float, float]:
        return self.slots[self.on_pitch.index(pid)]


class MatchSimulator:
    def __init__(self, home: TeamProfile, away: TeamProfile, seed: int = 7, scenario: str = "balanced",
                 intensity: float = 0.5, neutral: bool = False, goal_schedule: list[dict] | None = None,
                 scoring_bias: dict[str, float] | None = None, altitude_m: int | None = None,
                 acclimatised: tuple[str, ...] = (), plants: list[dict] | None = None):
        """`goal_schedule` switches the engine into conditioned mode: only the scheduled (real) goals are scored,
        at their real minutes, by their real scorers, and cards are not invented for real players."""
        if home.team_id == away.team_id:
            raise ValueError("home and away must be different teams")
        self.rng = random.Random(seed)
        self.seed = seed
        self.scenario = scenario if scenario in SCENARIOS else "balanced"
        self.intensity = clamp(intensity if self.scenario != "derby" else max(intensity, 0.85), 0.0, 1.0)
        bonus = 0.0 if neutral else 0.03
        self.home = TeamState(home, home.squad, home.formation, "home", attack=home.attack + bonus, defence=home.defence + bonus / 2)
        self.away = TeamState(away, away.squad, away.formation, "away", attack=away.attack, defence=away.defence)
        for team in (self.home, self.away):
            team.altitude_factor = altitude_fatigue(altitude_m, team.team_id in acclimatised)
        self.cos_rng = random.Random(seed * 31 + 7)       # cosmetic detail (speeds) never changes the match flow
        self._pass_p: float | None = None
        self._last_tick = 1.0
        self.plants = sorted([dict(p) for p in (plants or [])], key=lambda p: p["minute"])
        self.plant_labels: list[dict] = []
        self.conditioned = goal_schedule is not None
        self.raw_schedule = sorted(goal_schedule or [], key=lambda g: g["minute"])
        self.schedule: list[dict] = []
        self.scoring_bias = scoring_bias or {}
        self.favourite = self.home if (self.home.attack + self.home.defence) >= (self.away.attack + self.away.defence) else self.away
        self.underdog = self.away if self.favourite is self.home else self.home
        self.events: list[dict] = []
        self.truth: list[dict] = []
        self.score = {"home": 0, "away": 0}
        self.t = 0.0
        self.period = 1
        self.period_start = 0.0
        self.possession_id = 0
        self.counter_left = 0
        self.last_pass: dict | None = None
        self.added = (self.rng.randint(1, 4), self.rng.randint(3, 7))
        self._plan_schedule()
        self.forced_red_minute = self.rng.randint(30, 65) if (self.scenario == "red_card" and not self.conditioned) else None
        self.forced_red_team = self.rng.choice([self.home, self.away]) if self.forced_red_minute else None
        self.sub_windows_done: dict[str, set[int]] = {"home": set(), "away": set()}

    # ------------------------------------------------------------------ real-goal schedule (conditioned mode)

    def _plan_schedule(self) -> None:
        """Turn real goal minutes into target clock times. '90' goals after the first become stoppage time."""
        if not self.conditioned:
            return
        nineties = 0
        extra_p1 = extra_p2 = 0
        for g in self.raw_schedule:
            m = g["minute"]
            if m <= 45:
                period, elapsed = 1, (m - 1) * 60 + self.rng.uniform(25, 45)
                if m == 45 and any(x["minute"] == 45 and x is not g for x in self.raw_schedule[: self.raw_schedule.index(g)]):
                    elapsed = FIRST_HALF + 70
                    extra_p1 = max(extra_p1, 2)
            elif m < 90:
                period, elapsed = 2, (m - 46) * 60 + self.rng.uniform(25, 45)
            else:
                period = 2
                if m == 90 and nineties == 0:
                    elapsed = 44 * 60 + self.rng.uniform(12, 40)
                else:
                    k = (m - 90) if m > 90 else 1 + nineties
                    elapsed = FIRST_HALF + (k - 1) * 60 + self.rng.uniform(15, 40)
                    extra_p2 = max(extra_p2, k + 2)
                nineties += 1 if m == 90 else 0
            self.schedule.append({**g, "period": period, "elapsed": elapsed})
        self.schedule.sort(key=lambda g: (g["period"], g["elapsed"]))
        for i in range(1, len(self.schedule)):  # keep at least 75 s between scripted goals
            a, b = self.schedule[i - 1], self.schedule[i]
            if a["period"] == b["period"] and b["elapsed"] - a["elapsed"] < 75:
                b["elapsed"] = a["elapsed"] + 75
        self.added = (max(self.added[0], extra_p1), max(self.added[1], extra_p2))

    def scripted_goal_due(self) -> dict | None:
        if not self.schedule:
            return None
        g = self.schedule[0]
        target = (0.0 if g["period"] == 1 else FIRST_HALF + self.added[0] * 60) + g["elapsed"]
        if self.period == g["period"] and self.t >= target - (70 if g.get("penalty") else 34):
            g["t_target"] = target
            return g
        return None

    def protected(self, team: TeamState) -> set[str]:
        """Players with a real goal or assist still to come, or inside a planted spell, stay on the pitch."""
        out = set()
        for g in self.schedule:
            for key in ("scorer_pid", "assist_pid", "og_pid"):
                if g.get(key):
                    out.add(g[key])
        m = self.match_minute()
        for p in self.plants:
            if p.get("player_id") and p["minute"] - 5 <= m <= p["minute"] + p.get("duration", 25):
                out.add(p["player_id"])
        return out & set(team.on_pitch)

    def ensure_on_pitch(self, team: TeamState, pid: str) -> None:
        if pid in team.on_pitch or pid not in team.by_id:
            return
        prot = self.protected(team)
        cands = [p for p in team.on_pitch[1:] if p not in prot]
        if not cands:
            return
        off = cands[-1]
        idx = team.on_pitch.index(off)
        team.on_pitch[idx] = pid
        if pid in team.bench:
            team.bench.remove(pid)
        team.entered_at[pid] = self.t
        team.subs_used += 1
        _, sx, sy = team.slots[idx]
        self.emit("substitution", team, pid, sx, sy, sub_in=pid, sub_out=off)

    def execute_scripted_goal(self, g: dict, att: TeamState, carrier: str, x: float, y: float):
        self.schedule.pop(0)
        scoring = self.home if g["side"] == "home" else self.away
        conceding = self.other(scoring)
        if att is not scoring:
            mx, my = mirror(x, y)
            mx = clamp(mx, 30, 60)
            pid = self.nearest_own(scoring, mx, my)
            self.tick(1.0)
            self.emit("interception", scoring, pid, mx, my, outcome="success")
            self.new_possession()
            att, carrier, x, y = scoring, pid, mx, my
        scorer = g.get("scorer_pid")
        if not scorer and not g.get("own_goal"):
            # A goal the dataset doesn't credit to anyone (modelled): an attacker on the pitch scores it.
            outfield = att.on_pitch[1:]
            front = [p for p in outfield if POSITION_FAMILY[att.by_id[p].position] in ("FWD", "WIDE", "AM")] or outfield
            scorer = self.rng.choice(front)
        assister = g.get("assist_pid")
        if scorer and not g.get("own_goal"):
            self.ensure_on_pitch(att, scorer)
        if assister:
            self.ensure_on_pitch(att, assister)
        if g.get("og_pid"):
            self.ensure_on_pitch(conceding, g["og_pid"])
        self.t = max(self.t, g["t_target"] - (60 if g.get("penalty") else 24))

        def relay(to_pid: str, tx: float, ty: float, ptype: str = "short") -> None:
            nonlocal carrier, x, y
            if to_pid == carrier:
                self.tick(1.6)
                self.emit("carry", att, carrier, x, y, end_x=tx, end_y=ty, outcome="success")
            else:
                self.tick(1.2 + math.hypot(tx - x, ty - y) / 18)
                ev = self.emit("pass", att, carrier, x, y, end_x=tx, end_y=ty, outcome="success", recipient_id=to_pid, pass_type=ptype)
                self.last_pass = {"type": ptype, "recipient": to_pid, "event": ev["id"]}
            carrier, x, y = to_pid, tx, ty

        others = [p for p in att.on_pitch[1:] if p not in (scorer, assister)]
        # progress the ball into the final third through one or two team-mates
        for wx in ([max(x + 14, 55), 72] if x < 55 else [76]):
            nxt = self.rng.choice(others) if others else carrier
            relay(nxt, wx + self.rng.uniform(-3, 3), clamp(y + self.rng.uniform(-14, 14), 8, 60))

        if g.get("penalty"):
            taker = scorer if scorer in att.on_pitch else carrier
            relay(taker, 86 + self.rng.uniform(0, 3), 34 + self.rng.uniform(-8, 8))
            self.tick(1.5)
            self.emit("dribble", att, carrier, x, y, outcome="fail")
            dpid, _, _ = self.nearest_defender(att, x, y)
            fx, fy = mirror(x + 3, y)
            self.emit("foul", conceding, dpid, fx, fy, tags=["penalty_conceded"])
            self.t = max(self.t + 10, g["t_target"])
            return self.shoot(att, taker, LENGTH - 11, 34, "penalty", assist_type=None, forced="goal")

        if g.get("own_goal"):
            wide_y = 8 if self.rng.random() < 0.5 else 60
            crosser = assister if assister in att.on_pitch else (self.rng.choice(others) if others else carrier)
            relay(crosser, 92, wide_y)
            self.t = max(self.t + 2, g["t_target"])
            return self.shoot(att, crosser, 99.5, 33 + self.rng.uniform(-3, 3), "open_play", assist_type="cross",
                              forced="goal", own_goal_by=g.get("og_name"))

        sx, sy = self.rng.uniform(92, 100), self.rng.uniform(27, 41)
        if assister and assister in att.on_pitch:
            wide = self.rng.random() < 0.45
            ax, ay = (self.rng.uniform(86, 96), 7 if self.rng.random() < 0.5 else 61) if wide else (self.rng.uniform(74, 82), self.rng.uniform(26, 42))
            relay(assister, ax, ay)
            ptype = ("cross" if self.rng.random() < 0.55 else "cutback") if wide else "through_ball"
            self.t = max(self.t, g["t_target"] - 3)
            relay(scorer, sx, sy, ptype)
            header = ptype == "cross" and self.rng.random() < 0.5
            self.t = max(self.t + 1.2, g["t_target"])
            return self.shoot(att, scorer, sx, sy, "open_play", assist_type=ptype, header=header, forced="goal")
        # unassisted: the scorer receives deeper and drives at goal
        relay(scorer, self.rng.uniform(70, 80), self.rng.uniform(20, 48))
        if self.rng.random() < 0.6:
            self.tick(2.0)
            nx, ny = x + self.rng.uniform(5, 9), clamp(y + self.rng.gauss(0, 5), 18, 50)
            self.emit("dribble", att, carrier, x, y, end_x=nx, end_y=ny, outcome="success")
            x, y = nx, ny
        sx, sy = (x + self.rng.uniform(4, 12), clamp(y + self.rng.gauss(0, 4), 22, 46))
        self.tick(2.0)
        self.emit("carry", att, carrier, x, y, end_x=sx, end_y=sy, outcome="success")
        self.t = max(self.t, g["t_target"])
        return self.shoot(att, scorer, sx, sy, "open_play", assist_type=None, forced="goal")

    # ------------------------------------------------------------------ clock & emit

    def clock(self) -> tuple[int, int | None, int]:
        elapsed = self.t - self.period_start
        if self.period == 1:
            if elapsed >= FIRST_HALF:
                return 45, int((elapsed - FIRST_HALF) // 60) + 1, int(elapsed % 60)
            return int(elapsed // 60) + 1, None, int(elapsed % 60)
        minute = 45 + int(elapsed // 60) + 1
        if minute > 90:
            return 90, minute - 90, int(elapsed % 60)
        return minute, None, int(elapsed % 60)

    def match_minute(self) -> float:
        elapsed = self.t - self.period_start
        return (elapsed / 60.0) + (45 if self.period == 2 else 0)

    def emit(self, etype: str, team: TeamState, player_id: str | None, x: float, y: float, **kw) -> dict:
        minute, added, second = self.clock()
        ev = {
            "id": f"e{len(self.events) + 1:05d}", "seq": len(self.events) + 1, "period": self.period,
            "t": round(self.t, 1), "minute": minute, "second": second, "type": etype, "team_id": team.team_id,
            "x": round(clamp(x, 0, LENGTH), 1), "y": round(clamp(y, 0, WIDTH), 1), "possession_id": self.possession_id,
        }
        if added:
            ev["added_minute"] = added
        if player_id:
            ev["player_id"] = player_id
            ev["player_name"] = team.by_id[player_id].name
        for k, v in kw.items():
            if v is None:
                continue
            if k in ("end_x",):
                v = round(clamp(v, 0, LENGTH), 1)
            elif k in ("end_y",):
                v = round(clamp(v, 0, WIDTH), 1)
            ev[k] = v
        self._enrich(ev)
        ev["score"] = dict(self.score)
        self.events.append(ev)
        return ev

    def _enrich(self, ev: dict) -> None:
        """Brief features: pass length and difficulty, ball and shot speed, carry speed and sprint tags."""
        r = self.cos_rng
        t = ev["type"]
        tags = list(ev.get("tags") or [])
        if t in ("pass", "corner", "free_kick", "goal_kick", "throw_in", "kick_off") and "end_x" in ev:
            length = math.hypot(ev["end_x"] - ev["x"], ev["end_y"] - ev["y"])
            ev["pass_length"] = round(length, 1)
            base = {"short": 34, "long": 66, "switch": 70, "through_ball": 55, "cross": 64, "cutback": 42}.get(ev.get("pass_type") or "short", 40)
            if t == "throw_in":
                base = 28
            ev["ball_speed_kmh"] = round(clamp(base + length * 0.32 + r.gauss(0, 5), 14, 118))
            if t == "pass" and self._pass_p is not None:
                ev["difficulty"] = round(1 - self._pass_p, 2)
                if ev["difficulty"] >= 0.6:
                    tags.append("high_difficulty")
            self._pass_p = None
        elif t in ("carry", "dribble") and "end_x" in ev:
            dist = math.hypot(ev["end_x"] - ev["x"], ev["end_y"] - ev["y"])
            speed = dist / max(self._last_tick, 0.5) * 3.6
            ev["speed_kmh"] = round(speed, 1)
            if speed >= 25:
                tags.append("sprint")
        elif t == "shot":
            body, sit = ev.get("body_part"), ev.get("situation")
            base = 48 if body == "head" else 92 if sit == "penalty" else 88
            ev["shot_speed_kmh"] = round(clamp(base + r.gauss(0, 9 if body != "head" else 5), 30, 128))
            ev["ball_speed_kmh"] = ev["shot_speed_kmh"]
        if tags:
            ev["tags"] = tags

    # ------------------------------------------------------------------ planted scenario scripts (hidden truth)

    MAGNITUDE = {"obvious": 1.0, "moderate": 0.75, "subtle": 0.5}

    def apply_plants(self) -> None:
        m = self.match_minute()
        for p in self.plants:
            if p.get("_applied") or m < p["minute"]:
                continue
            p["_applied"] = True
            team = self.home if p["side"] == "home" else self.away if p["side"] == "away" else None
            mag = self.MAGNITUDE.get(p.get("difficulty", "obvious"), 1.0)
            mech = p["mechanism"]
            if mech == "press_switch" and team:
                sign = 1 if p.get("direction", "higher") == "higher" else -1
                team.plant_press += sign * 0.42 * mag
                team.plant_line += sign * 0.32 * mag
            elif mech == "shape_change" and team and not team.sent_off:
                target = p.get("to") or (DEFENSIVE_SHIFT.get(team.formation) if p.get("direction") == "back_five" else ATTACKING_SHIFT.get(team.formation))
                if target and target != team.formation:
                    self.change_shape(team, target, "planted")
            minute, _, _ = self.clock()
            label = {k: v for k, v in p.items() if not k.startswith("_")}
            label.update({"t": round(self.t, 1), "minute": minute, "team_id": team.team_id if team else "both"})
            if p.get("player_id") and team:
                label["player_name"] = team.by_id[p["player_id"]].name
            self.plant_labels.append(label)

    def plant_active(self, mechanism: str, side: str | None = None, player_id: str | None = None) -> float:
        """Magnitude of an active planted effect (0 when none)."""
        if not self.plants:
            return 0.0
        m = self.match_minute()
        for p in self.plants:
            if p["mechanism"] != mechanism or m < p["minute"]:
                continue
            if p.get("duration") and m > p["minute"] + p["duration"]:
                continue
            if side and p["side"] not in (side, "both"):
                continue
            if player_id and p.get("player_id") != player_id:
                continue
            return self.MAGNITUDE.get(p.get("difficulty", "obvious"), 1.0)
        return 0.0

    def tired_fullback_channel(self, att: TeamState) -> tuple[str, float]:
        """Channel (in the attackers' frame) defended by a planted tiring full-back of the other side."""
        dfn = self.other(att)
        for p in self.plants:
            if p["mechanism"] != "tiring_fullback" or p["side"] != dfn.side or self.match_minute() < p["minute"]:
                continue
            pid = p.get("player_id")
            if pid not in dfn.on_pitch:
                continue
            mag = self.MAGNITUDE.get(p.get("difficulty", "obvious"), 1.0)
            pos = dfn.by_id[pid].position
            return ("left" if pos in ("RB", "RWB") else "right"), mag
        return "", 0.0

    def tick(self, seconds: float) -> None:
        self._last_tick = max(0.4, seconds)
        self.t += self._last_tick

    def other(self, team: TeamState) -> TeamState:
        return self.away if team is self.home else self.home

    # ------------------------------------------------------------------ spatial model

    def defensive_depth(self, defending: TeamState, ball_x_att: float) -> float:
        """Distance of the defending team's back line from its own goal, given the ball's x in the attackers' frame.
        Deep (6-8 m) when the ball is in the box, ~35 m when the ball is at halfway; a high line pushes it up."""
        d = 35 - 0.62 * max(0.0, ball_x_att - 52) + 0.15 * max(0.0, 52 - ball_x_att)
        return clamp(d + 10 * (defending.line() - 0.5), 6.0, 44.0)

    def positions(self, team: TeamState, in_possession: bool, ball_x: float, ball_y: float) -> list[tuple[str, float, float, bool]]:
        """Player positions in `team`'s own frame. `ball_*` are in that same frame.

        In possession the shape stretches up the pitch but nobody stands beyond the opponent's offside line.
        Out of possession the block compresses: the back line sits at `defensive_depth`, midfield and forwards
        stack ahead of it, and the whole block slides toward the ball's side."""
        out = []
        other = self.other(team)
        outfield_x = [sx for (pos, sx, sy) in team.slots if pos != "GK"]
        min_sx = min(outfield_x) if outfield_x else 22
        if in_possession:
            offside_line = LENGTH - self.defensive_depth(other, ball_x) + 1.0
            shift_x = clamp((ball_x - 50) * 0.32, -11, 15)
        else:
            depth = self.defensive_depth(team, LENGTH - ball_x)
        for idx, pid in enumerate(team.on_pitch):
            pos, sx, sy = team.slots[idx]
            if pos == "GK":
                gx = 4 + 10 * team.line() + max(0.0, (ball_x - 60) * 0.12)
                out.append((pid, gx + self.rng.gauss(0, 1), 34 + (ball_y - 34) * 0.15, True))
                continue
            if in_possession:
                x = sx + 3 + 8 * team.line() + 4 * team.risk + shift_x
                x = min(x, offside_line - self.rng.uniform(0, 3))
                y = 34 + (sy - 34) * (0.95 + 0.15 * team.style.width) + (ball_y - 34) * 0.25
            else:
                x = depth + (sx - min_sx) * 0.62
                y = 34 + (sy - 34) * 0.74 + (ball_y - 34) * 0.34
            out.append((pid, clamp(x + self.rng.gauss(0, 2.2), 1, 104), clamp(y + self.rng.gauss(0, 2.4), 1, 67), False))
        return out

    def freeze_frame(self, att: TeamState, carrier: str, bx: float, by: float) -> list[dict]:
        frame = []
        for pid, x, y, gk in self.positions(att, True, bx, by):
            if pid == carrier:
                x, y = bx, by
            item = {"player_id": pid, "team_id": att.team_id, "x": round(x, 1), "y": round(y, 1)}
            if pid == carrier:
                item["actor"] = True
            if gk:
                item["gk"] = True
            frame.append(item)
        dfn = self.other(att)
        dbx, dby = mirror(bx, by)
        for pid, x, y, gk in self.positions(dfn, False, dbx, dby):
            mx, my = mirror(x, y)
            if gk:
                # keeper sits on the line, shading toward the shooter
                mx, my = LENGTH - 1.5 - min(4.0, max(0.0, (LENGTH - bx) * 0.12)), 34 + (by - 34) * 0.18
            elif bx > 70:
                # defenders collapse between ball and goal when the ball is near the box
                pull = 0.35 if in_box(bx, by) else 0.2
                mx = mx + (min(LENGTH - 2, max(bx, mx)) - mx) * pull
                my = my + (34 + (by - 34) * 0.5 - my) * pull
            item = {"player_id": pid, "team_id": dfn.team_id, "x": round(clamp(mx, 0.5, 104.5), 1), "y": round(clamp(my, 0.5, 67.5), 1)}
            if gk:
                item["gk"] = True
            frame.append(item)
        # the two nearest defenders close the shooter down: one steps into the shooting line, one covers
        defenders = sorted((p for p in frame if p["team_id"] == dfn.team_id and not p.get("gk")),
                           key=lambda p: math.hypot(p["x"] - bx, p["y"] - by))
        for k, p in enumerate(defenders[:2]):
            if self.rng.random() < (0.62 if k == 0 else 0.35):
                gap = self.rng.uniform(1.2, 4.5)
                dist = max(math.hypot(LENGTH - bx, 34 - by), 0.1)
                p["x"] = round(clamp(bx + (LENGTH - bx) / dist * gap, 0.5, 104.5), 1)
                p["y"] = round(clamp(by + (34 - by) / dist * gap + self.rng.gauss(0, 0.8), 0.5, 67.5), 1)
        return frame

    def presser(self, att: TeamState, x: float, y: float) -> str:
        """The defender who closes the ball down: one of the nearest three, weighted by pressing appetite."""
        dfn = self.other(att)
        mx, my = mirror(x, y)
        near = sorted(((pid, math.hypot(px - mx, py - my)) for pid, px, py, gk in self.positions(dfn, False, mx, my) if not gk),
                      key=lambda r: r[1])[:3]
        return self.rng.choices([n[0] for n in near], weights=[dfn.traits[n[0]].press / (1 + n[1] / 6) for n in near])[0]

    def nearest_defender(self, att: TeamState, x: float, y: float, exclude_gk: bool = True) -> tuple[str, float, float]:
        dfn = self.other(att)
        mx, my = mirror(x, y)
        best, bd = None, 1e9
        for pid, px, py, gk in self.positions(dfn, False, mx, my):
            if exclude_gk and gk:
                continue
            role = DEFEND_WEIGHT.get(POSITION_FAMILY[dfn.by_id[pid].position], 1.0)
            d = math.hypot(px - mx, py - my) / role + self.rng.uniform(0, 4)
            if d < bd:
                best, bd = (pid, px, py), d
        return best

    # ------------------------------------------------------------------ scenario & state modifiers

    def scoring_multiplier(self, team: TeamState) -> float:
        m = self.match_minute()
        s = self.scenario
        mult = self.scoring_bias.get(team.side, 1.0)
        if s == "late_drama" and m >= 78:
            mult *= 1.9
        elif s == "comeback":
            if team is self.favourite:
                mult *= 1.9 if m < 38 else 0.55 if m > 58 else 1.0
            else:
                mult *= 0.55 if m < 38 else 2.1 if m > 58 else 1.0
        elif s == "tactical_chess":
            mult *= 0.6
        elif s == "goal_fest":
            mult *= 1.65
        elif s == "underdog":
            mult *= 1.35 if team is self.underdog else 0.8
        return mult

    def update_game_state(self) -> None:
        m = self.match_minute()
        for team in (self.home, self.away):
            diff = self.score[team.side] - self.score[self.other(team).side]
            urgency = clamp((m - 55) / 35, 0, 1)
            if diff < 0:
                team.risk = urgency * (0.6 if diff == -1 else 0.85)
                team.press_boost, team.line_boost = 0.15 * urgency, 0.2 * urgency
            elif diff > 0:
                team.risk = -0.3 * urgency
                team.press_boost, team.line_boost = -0.15 * urgency, -0.2 * urgency
            else:
                team.risk = 0.15 * urgency
                team.press_boost, team.line_boost = 0.0, 0.0
            if self.scenario == "derby":
                team.press_boost += 0.1
            # record the engine's own (natural) pressing changes so the Grader doesn't call them false alarms
            mode = "higher" if team.press_boost >= 0.08 else "lower" if team.press_boost <= -0.08 else None
            if mode and getattr(team, "_press_mode", None) != mode:
                team._press_mode = mode
                minute, _, _ = self.clock()
                self.truth.append({"type": "press_change", "team_id": team.team_id, "minute": minute, "t": round(self.t, 1),
                                   "direction": mode, "reason": "game state"})
            if len(team.sent_off):
                team.line_boost -= 0.15

    def fatigue_penalty(self, team: TeamState, pid: str) -> float:
        mins_on = (self.t - team.entered_at.get(pid, 0.0)) / 60
        stamina = team.by_id[pid].stamina * team.traits[pid].stamina
        onset = 60 if team.altitude_factor == 1.0 else 50
        base = max(0.0, (mins_on - onset) / 40) * (1.1 - min(stamina, 1.05)) * 0.12 * team.altitude_factor
        mag = self.plant_active("tiring_fullback", team.side, pid)
        return base + 0.22 * mag if mag else base

    # ------------------------------------------------------------------ substitutions & shape changes

    def reassign(self, team: TeamState, new_formation: str) -> None:
        old = {pid: team.slots[i] for i, pid in enumerate(team.on_pitch)}
        new_slots = list(FORMATIONS[new_formation])
        players = list(team.on_pitch)
        assigned: list[str | None] = [None] * len(new_slots)
        assigned[0] = players[0]  # goalkeeper stays
        remaining = players[1:]
        for i in range(1, len(new_slots)):
            pos, sx, sy = new_slots[i]
            fam = POSITION_FAMILY[pos]

            def cost(pid: str, sx: float = sx, sy: float = sy, fam: str = fam) -> float:
                _, ox, oy = old[pid]
                f = POSITION_FAMILY[team.by_id[pid].position]
                return math.hypot(ox - sx, oy - sy) + (0 if f == fam else 12)
            if not remaining:
                break
            best = min(remaining, key=cost)
            assigned[i] = best
            remaining.remove(best)
        team.slots = [s for s, a in zip(new_slots, assigned) if a]
        team.on_pitch = [a for a in assigned if a]
        team.formation = new_formation

    def maybe_substitutions(self) -> None:
        m = self.match_minute()
        for window in (58, 67, 76, 84):
            if m < window:
                continue
            for team in (self.home, self.away):
                if window in self.sub_windows_done[team.side]:
                    continue
                self.sub_windows_done[team.side].add(window)
                diff = self.score[team.side] - self.score[self.other(team).side]
                # tactical shape change
                if window in (58, 67) and diff < 0 and team.formation in ATTACKING_SHIFT and not team.sent_off:
                    p = 1.0 if (self.scenario == "comeback" and team is self.underdog) else 0.55
                    if self.rng.random() < p and not any(t["type"] == "formation_change" and t["team_id"] == team.team_id for t in self.truth):
                        self.do_sub(team, attacking=True)
                        self.change_shape(team, ATTACKING_SHIFT[team.formation], "chasing the game")
                        continue
                if window >= 76 and diff == 1 and team.formation in DEFENSIVE_SHIFT and not team.sent_off:
                    if self.rng.random() < 0.4 and not any(t["type"] == "formation_change" and t["team_id"] == team.team_id for t in self.truth):
                        self.do_sub(team, defensive=True)
                        self.change_shape(team, DEFENSIVE_SHIFT[team.formation], "protecting the lead")
                        continue
                n = self.rng.choice([1, 1, 2]) if window < 84 else self.rng.choice([0, 1])
                for _ in range(n):
                    self.do_sub(team)

    def change_shape(self, team: TeamState, formation: str, reason: str) -> None:
        old = team.formation
        self.reassign(team, formation)
        minute, _, _ = self.clock()
        trigger = self.events[-1]["id"] if self.events else None
        self.truth.append({"type": "formation_change", "team_id": team.team_id, "minute": minute, "t": self.t,
                           "from": old, "to": formation, "reason": reason, "trigger_event_id": trigger})

    def do_sub(self, team: TeamState, attacking: bool = False, defensive: bool = False) -> None:
        if team.subs_used >= 5 or not team.bench:
            return
        prot = self.protected(team)
        outfield = [pid for pid in team.on_pitch[1:] if pid not in prot]
        if not outfield:
            return
        if attacking:
            cands = [p for p in outfield if POSITION_FAMILY[team.by_id[p].position] in ("DEF", "MID", "WB")]
        elif defensive:
            cands = [p for p in outfield if POSITION_FAMILY[team.by_id[p].position] in ("FWD", "WIDE", "AM")]
        else:
            cands = outfield
        if not cands:
            cands = outfield
        off = max(cands, key=lambda p: self.fatigue_penalty(team, p) + self.rng.uniform(0, 0.02) + (0.05 if p in team.yellow else 0))
        fam = POSITION_FAMILY[team.by_id[off].position]
        if attacking:
            pref = [b for b in team.bench if POSITION_FAMILY[team.by_id[b].position] in ("FWD", "WIDE", "AM")]
        elif defensive:
            pref = [b for b in team.bench if POSITION_FAMILY[team.by_id[b].position] in ("DEF", "MID", "WB")]
        else:
            pref = [b for b in team.bench if POSITION_FAMILY[team.by_id[b].position] == fam]
        pref = [b for b in pref if team.by_id[b].position != "GK"] or [b for b in team.bench if team.by_id[b].position != "GK"]
        if not pref:
            return
        on = pref[0]
        idx = team.on_pitch.index(off)
        team.on_pitch[idx] = on
        team.bench.remove(on)
        team.entered_at[on] = self.t
        team.subs_used += 1
        _, sx, sy = team.slots[idx]
        self.tick(self.rng.uniform(20, 35))
        self.emit("substitution", team, on, sx, sy, sub_in=on, sub_out=off,
                  tags=["tactical"] if (attacking or defensive) else None)

    # ------------------------------------------------------------------ discipline

    def foul(self, fouler_team: TeamState, fouler: str, x_att: float, y_att: float) -> tuple[str, float, float]:
        """Defending team fouls at (x_att, y_att) in the attacking team's frame. Returns the restart for the attackers."""
        if self.conditioned and in_box(x_att, y_att):
            x_att = BOX_X - 1.5          # real matches: no invented penalties
        fx, fy = mirror(x_att, y_att)
        penalty = in_box(x_att, y_att)
        self.emit("foul", fouler_team, fouler, fx, fy, tags=["penalty_conceded"] if penalty else None)
        card_p = 0.0 if self.conditioned else (0.15 + 0.10 * self.intensity) * (1.6 if penalty else 1.0)
        if self.conditioned:
            pass                          # real matches: no invented bookings for real players
        elif self.rng.random() < card_p:
            self.book(fouler_team, fouler, fx, fy, second_offence=fouler in fouler_team.yellow)
        elif self.rng.random() < 0.004 + 0.004 * self.intensity:
            self.book(fouler_team, fouler, fx, fy, straight_red=True)
        self.tick(self.rng.uniform(8, 16))
        return ("penalty", LENGTH - 11, 34.0) if penalty else ("free_kick", x_att, y_att)

    def book(self, team: TeamState, pid: str, x: float, y: float, second_offence: bool = False, straight_red: bool = False) -> None:
        if pid in team.sent_off or pid not in team.on_pitch:
            return
        if straight_red or second_offence:
            card = "red" if straight_red else "second_yellow"
            self.emit("card", team, pid, x, y, card=card)
            self.send_off(team, pid, card)
        else:
            team.yellow.add(pid)
            self.emit("card", team, pid, x, y, card="yellow")
        self.tick(self.rng.uniform(15, 30))

    def send_off(self, team: TeamState, pid: str, card: str) -> None:
        team.sent_off.add(pid)
        idx = team.on_pitch.index(pid)
        team.on_pitch.pop(idx)
        team.slots.pop(idx)
        old = team.formation
        new = TEN_MAN_SHAPE.get(old, "4-4-1")
        if len(team.on_pitch) == 10:
            self.reassign(team, new)
        team.attack -= 0.06
        team.defence -= 0.07
        minute, _, _ = self.clock()
        self.truth.append({"type": "red_card", "team_id": team.team_id, "minute": minute, "t": self.t, "player_id": pid, "card": card})
        if len(team.on_pitch) == 10:
            self.truth.append({"type": "formation_change", "team_id": team.team_id, "minute": minute, "t": self.t,
                               "from": old, "to": new, "reason": "red card", "trigger_event_id": self.events[-1]["id"]})

    # ------------------------------------------------------------------ main loop

    def run(self) -> dict:
        att = self.home
        restart = ("kick_off", 52.5, 34.0)
        for period in (1, 2):
            self.period = period
            self.period_start = 0.0 if period == 1 else FIRST_HALF + self.added[0] * 60
            self.t = self.period_start
            end = self.period_start + FIRST_HALF + self.added[period - 1] * 60
            att = self.home if period == 1 else self.away
            restart = ("kick_off", 52.5, 34.0)
            while self.t < end:
                self.update_game_state()
                self.apply_plants()
                if period == 2:
                    self.maybe_substitutions()
                if self.forced_red_minute and self.match_minute() >= self.forced_red_minute and self.forced_red_team and not self.forced_red_team.sent_off:
                    team = self.forced_red_team
                    victim = self.rng.choice(team.on_pitch[1:5])
                    ox, oy = mirror(55, 34)
                    self.emit("foul", team, victim, ox, oy, tags=["serious_foul_play"])
                    self.book(team, victim, ox, oy, straight_red=True)
                    self.forced_red_minute = None
                    att = self.other(team)
                    restart = ("free_kick", 50.0, 34.0)
                att, restart = self.play_possession(att, restart, end)
            self.emit("half_end" if period == 1 else "full_time", att, None, 52.5, 34.0)
        return {"events": self.events, "score": dict(self.score)}

    def new_possession(self) -> None:
        self.possession_id += 1
        self.last_pass = None

    def play_possession(self, att: TeamState, restart: tuple, end: float) -> tuple[TeamState, tuple]:
        """Play one possession for `att`. Returns (team with the next possession, restart descriptor)."""
        self.new_possession()
        kind, x, y = restart[0], restart[1], restart[2]
        dfn = self.other(att)
        situation = "open_play"
        carrier: str

        if kind == "kick_off":
            carrier = att.on_pitch[-1]
            recv = self.pick_receiver(att, carrier, x, y, prefer_back=True)
            rx, ry = recv[1], recv[2]
            self.emit("kick_off", att, carrier, x, y, end_x=rx, end_y=ry, outcome="success", recipient_id=recv[0], pass_type="short")
            self.tick(2)
            carrier, x, y = recv[0], rx, ry
        elif kind in ("throw_in", "goal_kick", "free_kick", "corner", "penalty"):
            res = self.restart(att, kind, x, y)
            if res is None:
                return att, ("goal_kick", 6.0, 34.0)
            if isinstance(res, tuple) and len(res) == 2 and isinstance(res[0], TeamState):
                return res
            carrier, x, y, situation = res
        else:  # turnover / open-play regain
            carrier = restart[3] if len(restart) > 3 else self.nearest_own(att, x, y)

        if kind == "regain" and self.counter_left <= 0:
            if x < 50 and dfn.line() > 0.5 and self.rng.random() < 0.18 + 0.25 * att.style.directness:
                self.counter_left = 5
        actions = 0
        while self.t < end:
            actions += 1
            if self.counter_left > 0:
                situation = "counter"
                self.counter_left -= 1
            elif situation == "counter":
                situation = "open_play"
            due = self.scripted_goal_due() if self.conditioned else None
            if due:
                self.counter_left = 0
                return self.execute_scripted_goal(due, att, carrier, x, y)
            outcome = self.act(att, carrier, x, y, situation)
            if outcome[0] == "continue":
                _, carrier, x, y = outcome
                if situation == "set_piece" and actions > 2:
                    situation = "open_play"
                continue
            self.counter_left = 0
            return outcome[1], outcome[2]
        return att, ("kick_off", 52.5, 34.0)

    def nearest_own(self, team: TeamState, x: float, y: float) -> str:
        best = min(self.positions(team, True, x, y)[1:], key=lambda p: math.hypot(p[1] - x, p[2] - y))
        return best[0]

    # ------------------------------------------------------------------ restarts

    def restart(self, att: TeamState, kind: str, x: float, y: float):
        dfn = self.other(att)
        if kind == "penalty":
            taker = max(att.on_pitch[1:], key=lambda p: att.by_id[p].finishing)
            self.tick(self.rng.uniform(40, 70))
            return self.shoot(att, taker, LENGTH - 11, 34, "penalty", assist_type=None)
        if kind == "corner":
            side_y = 0.5 if y < 34 else 67.5
            taker = max(att.on_pitch[1:], key=lambda p: att.by_id[p].passing + self.rng.uniform(0, 0.2))
            self.tick(self.rng.uniform(18, 30))
            tx, ty = self.rng.uniform(93, 101), self.rng.uniform(27, 41)
            routine = self.plant_active("set_piece_routine", att.side)
            if routine:
                tx = self.rng.uniform(98.5, 101.5)
                ty = self.rng.uniform(28.5, 31.5) if side_y < 34 else self.rng.uniform(36.5, 39.5)
            if self.rng.random() < 0.13:
                recv = self.pick_receiver(att, taker, 104.5, side_y, prefer_back=True)
                self.emit("corner", att, taker, 104.5, side_y, end_x=recv[1], end_y=recv[2], outcome="success",
                          recipient_id=recv[0], pass_type="short")
                return recv[0], recv[1], recv[2], "set_piece"
            target = self.aerial_target(att, taker)
            if self.rng.random() < 0.31 + 0.1 * att.attack - 0.08 * dfn.defence + 0.14 * routine:
                self.emit("corner", att, taker, 104.5, side_y, end_x=tx, end_y=ty, outcome="success",
                          recipient_id=target, pass_type="cross")
                self.last_pass = {"type": "cross", "recipient": target}
                if self.rng.random() < 0.5:
                    return self.shoot(att, target, tx, ty, "set_piece", assist_type="cross", header=self.rng.random() < 0.8)
                return target, tx, ty, "set_piece"
            self.emit("corner", att, taker, 104.5, side_y, end_x=tx, end_y=ty, outcome="fail", pass_type="cross")
            return self.defensive_clear(att, tx, ty)
        if kind == "goal_kick":
            gk = att.gk()
            self.tick(self.rng.uniform(13, 21))
            long = self.rng.random() < 0.25 + 0.6 * att.directness() - 0.25 * att.style.possession
            if long:
                tx, ty = self.rng.uniform(50, 72), self.rng.uniform(14, 54)
                if self.rng.random() < 0.5:
                    recv = self.nearest_own(att, tx, ty)
                    self.emit("goal_kick", att, gk, 6, 34, end_x=tx, end_y=ty, outcome="success", recipient_id=recv, pass_type="long")
                    return recv, tx, ty, "open_play"
                self.emit("goal_kick", att, gk, 6, 34, end_x=tx, end_y=ty, outcome="fail", pass_type="long")
                dpid, dx, dy = self.nearest_defender(att, tx, ty)
                self.tick(1.5)
                self.emit("recovery", dfn, dpid, dx, dy)
                return dfn, ("regain", dx, dy, dpid)
            recv = self.pick_receiver(att, gk, 6, 34, prefer_back=True)
            self.emit("goal_kick", att, gk, 6, 34, end_x=recv[1], end_y=recv[2], outcome="success", recipient_id=recv[0], pass_type="short")
            return recv[0], recv[1], recv[2], "open_play"
        if kind == "throw_in":
            ty = 0.5 if y < 34 else 67.5
            thrower = min(att.on_pitch[1:], key=lambda p: abs(self.positions(att, True, x, ty)[att.on_pitch.index(p)][2] - ty) + self.rng.uniform(0, 6))
            self.tick(self.rng.uniform(7, 13))
            recv = self.pick_receiver(att, thrower, x, ty, max_dist=22)
            ok = self.rng.random() < 0.80
            if ok:
                self.emit("throw_in", att, thrower, x, ty, end_x=recv[1], end_y=recv[2], outcome="success", recipient_id=recv[0])
                return recv[0], recv[1], recv[2], "open_play"
            self.emit("throw_in", att, thrower, x, ty, end_x=recv[1], end_y=recv[2], outcome="fail")
            dpid, dx, dy = self.nearest_defender(att, recv[1], recv[2])
            self.emit("interception", dfn, dpid, dx, dy, outcome="success")
            return dfn, ("regain", dx, dy, dpid)
        # free kick
        taker = max(att.on_pitch[1:], key=lambda p: att.by_id[p].passing + self.rng.uniform(0, 0.15))
        self.tick(self.rng.uniform(8, 18))
        dist = distance_to_goal(x, y)
        if x > 72 and 18 < y < 50 and dist < 31 and self.rng.random() < 0.38:
            return self.shoot(att, taker, x, y, "set_piece", assist_type=None, direct_free_kick=True, restart_type="free_kick")
        if x > 70 and self.rng.random() < 0.6:
            tx, ty = self.rng.uniform(92, 100), self.rng.uniform(26, 42)
            target = self.aerial_target(att, taker)
            if self.rng.random() < 0.30:
                self.emit("free_kick", att, taker, x, y, end_x=tx, end_y=ty, outcome="success", recipient_id=target, pass_type="cross")
                self.last_pass = {"type": "cross", "recipient": target}
                return self.shoot(att, target, tx, ty, "set_piece", assist_type="cross", header=self.rng.random() < 0.75)
            self.emit("free_kick", att, taker, x, y, end_x=tx, end_y=ty, outcome="fail", pass_type="cross")
            return self.defensive_clear(att, tx, ty)
        recv = self.pick_receiver(att, taker, x, y)
        self.emit("free_kick", att, taker, x, y, end_x=recv[1], end_y=recv[2], outcome="success", recipient_id=recv[0],
                  pass_type="long" if math.hypot(recv[1] - x, recv[2] - y) > 30 else "short")
        return recv[0], recv[1], recv[2], "open_play"

    def aerial_target(self, att: TeamState, taker: str) -> str:
        cands = [p for p in att.on_pitch[1:] if p != taker and POSITION_FAMILY[att.by_id[p].position] in ("FWD", "DEF", "AM", "WIDE")]
        cands = cands or [p for p in att.on_pitch[1:] if p != taker]
        return self.rng.choices(cands, weights=[att.traits[p].aerial for p in cands])[0]

    def defensive_clear(self, att: TeamState, x: float, y: float):
        dfn = self.other(att)
        dpid, dx, dy = self.nearest_defender(att, x, y)
        self.tick(1.2)
        ex, ey = dx + self.rng.uniform(25, 45), clamp(dy + self.rng.uniform(-20, 20), 1, 67)
        self.emit("clearance", dfn, dpid, dx, dy, end_x=ex, end_y=ey, outcome="success")
        r = self.rng.random()
        if r < 0.3:
            return att, ("corner", 104.5, y)
        if r < 0.45:
            # second ball won back by the attacking side
            ax, ay = mirror(ex, ey)
            pid = self.nearest_own(att, ax, ay)
            self.tick(2)
            self.emit("recovery", att, pid, ax, ay)
            return pid, ax, ay, "open_play"
        if r < 0.65:
            ax, ay = mirror(ex, ey)
            return att, ("throw_in", ax, ay)
        pid = self.nearest_own(dfn, ex, ey)
        self.tick(2)
        self.emit("recovery", dfn, pid, ex, ey)
        return dfn, ("regain", ex, ey, pid)

    # ------------------------------------------------------------------ open play

    def pick_receiver(self, att: TeamState, carrier: str, x: float, y: float, prefer_back: bool = False,
                      max_dist: float = 70) -> tuple[str, float, float, float]:
        cands = []
        target_channel, target_mag = self.tired_fullback_channel(att)
        for pid, px, py, gk in self.positions(att, True, x, y):
            if pid == carrier:
                continue
            dx, dist = px - x, math.hypot(px - x, py - y)
            if dist > max_dist or dist < 3:
                continue
            w = math.exp(-(((dist - 15) / 13) ** 2))
            if dx > 0:
                w *= 1 + att.directness() * dx / 18
            elif dx < -12:
                w *= (0.4 + 0.45 * att.style.possession) if not prefer_back else 0.9
            if dist > 32:
                w *= (0.15 + 1.2 * att.directness()) * att.traits[carrier].long_pass
            if gk:
                w *= 0.9 if x < 30 else 0.25 if x < 45 else 0.01
            w *= RECEIVE_WEIGHT.get(POSITION_FAMILY[att.by_id[pid].position], 1.0)
            hot = self.plant_active("hot_streak", att.side, pid)
            if hot:
                w *= 1 + 3.5 * hot                       # team-mates feed the man on a hot streak
            if target_channel and channel(py) == target_channel and px > 55:
                w *= 1 + 2.6 * target_mag
            if (py < 15 or py > 53) and px > 55:
                w *= 0.6 + 0.8 * att.style.width
            cands.append((pid, px, py, max(w, 1e-4)))
        if not cands:
            pid = self.rng.choice([p for p in att.on_pitch if p != carrier])
            return pid, x, y, 1.0
        total = sum(c[3] for c in cands)
        r = self.rng.uniform(0, total)
        for c in cands:
            r -= c[3]
            if r <= 0:
                return c
        return cands[-1]

    def act(self, att: TeamState, carrier: str, x: float, y: float, situation: str):
        dfn = self.other(att)
        player = att.by_id[carrier]
        dist = distance_to_goal(x, y)
        boxed = in_box(x, y)
        risk = att.risk
        weights: dict[str, float] = {}
        if boxed:
            weights["shot"] = (0.155 + 0.29 * (1 - min(dist, 18) / 18)) * (1 + 0.4 * risk)
        elif x > 74 and 16 < y < 52 and dist < 30:
            weights["shot"] = (0.09 + 0.08 * player.finishing) * (1 + 0.8 * max(risk, 0))
        if x > 72 and (y < 15 or y > 53):
            weights["cross"] = 0.05 + 0.16 * att.style.crossing + 0.1 * max(risk, 0)
        weights["dribble"] = 0.02 + 0.04 * player.dribbling + (0.03 if x > 65 else 0.0)
        weights["carry"] = 0.10 + 0.08 * att.style.tempo
        weights["pass"] = max(0.2, 1.0 - sum(weights.values()))
        streak = self.plant_active("hot_streak", att.side, carrier)
        if streak and "shot" in weights:
            weights["shot"] *= 1 + 3.0 * streak
        elif streak and x > 70:
            weights["shot"] = 0.25 * streak            # on a hot streak he shoots on sight
        tired_ch, tired_mag = self.tired_fullback_channel(att)
        if tired_mag and channel(y) == tired_ch:
            if "cross" in weights:
                weights["cross"] *= 1 + 1.2 * tired_mag
            weights["dribble"] = weights.get("dribble", 0.05) * (1 + tired_mag)
        if "shot" in weights:
            tr = att.traits[carrier]
            fam = POSITION_FAMILY[player.position]
            if boxed:
                weights["shot"] *= {"FWD": 2.3, "WIDE": 1.1, "AM": 1.0, "MID": 0.8, "WB": 0.85, "DEF": 0.9}.get(fam, 1.0)
            else:
                weights["shot"] *= tr.long_shot * {"FWD": 0.33, "DEF": 0.6, "AM": 0.7, "MID": 0.85}.get(fam, 1.0)
            weights["shot"] *= 0.55 + 1.35 * tr.shot_channel[channel(y)]
        if POSITION_FAMILY[player.position] == "GK":
            weights = {"pass": 1.0}
        action = self.rng.choices(list(weights), weights=list(weights.values()))[0]

        # pressing: out-of-possession pressure on the ball carrier
        planted_press = self.plant_active("press_switch", dfn.side)
        press_zone = x < 70 - 25 * (1 - dfn.press()) + 12 * planted_press
        if press_zone and self.rng.random() < (0.08 + 0.22 * dfn.press()) * (1 + 1.3 * planted_press):
            dpid = self.presser(att, x, y)
            self.emit("pressure", dfn, dpid, *mirror(x, y))
            under_pressure = True
            if not in_box(x, y) and self.rng.random() < 0.055 + 0.065 * self.intensity:
                return ("end", att, self.foul(dfn, dpid, x, y))
        else:
            under_pressure = False

        if action == "shot":
            assist = self.last_pass["type"] if self.last_pass and self.last_pass.get("recipient") == carrier else None
            return ("end",) + self.shoot(att, carrier, x, y, situation, assist_type=assist)
        if action == "cross":
            return self.cross(att, carrier, x, y, situation)
        if action == "dribble":
            return self.dribble(att, carrier, x, y, situation)
        if action == "carry":
            gain = self.rng.uniform(3, 10) * (0.7 + 0.6 * att.style.tempo)
            nx = clamp(x + gain * (0.35 if x > 85 else 1.0), 1, 97)
            ny = clamp(y + self.rng.gauss(0, 4.5), 2, 66)
            burst = situation == "counter" or (x > 55 and self.cos_rng.random() < 0.22)
            if burst:                 # running with the ball at pace: counter-attacks and attacking runs
                pace = att.traits[carrier].pace_kmh / 3.6
                self.tick(max(0.6, math.hypot(nx - x, ny - y) / (pace * self.cos_rng.uniform(0.78, 0.92))))
            else:
                self.tick(gain / 5 + 0.8)
            self.emit("carry", att, carrier, x, y, end_x=nx, end_y=ny, outcome="success")
            return ("continue", carrier, nx, ny)
        return self.pass_ball(att, carrier, x, y, situation, under_pressure)

    def pass_ball(self, att: TeamState, carrier: str, x: float, y: float, situation: str, under_pressure: bool):
        dfn = self.other(att)
        player = att.by_id[carrier]
        pid, rx, ry, _ = self.pick_receiver(att, carrier, x, y)
        dx, dist = rx - x, math.hypot(rx - x, ry - y)
        ptype = "short"
        if abs(ry - y) > 34 and dist > 30:
            ptype = "switch"
        elif dist > 32:
            ptype = "long"
        if dx > 10 and x > 48 and rx < 100 and self.rng.random() < 0.13 + 0.18 * att.directness() + (0.15 if situation == "counter" else 0):
            ptype = "through_ball"
            rx = clamp(rx + self.rng.uniform(5, 12), 0, 101)
        if x > 92 and dx < -3 and (y < 22 or y > 46) and self.rng.random() < 0.5:
            ptype = "cutback"
        base = {"short": 0.905, "long": 0.60, "switch": 0.72, "through_ball": 0.46, "cutback": 0.62}[ptype]
        p = base + (player.passing - 0.6) * 0.22 + att.style.possession * 0.04
        p -= dfn.press() * (0.07 if x < 60 else 0.03) + (0.06 if under_pressure else 0)
        p -= 0.07 if rx > 75 else 0.0
        p -= self.fatigue_penalty(att, carrier)
        p += 0.03 * (att.attack - dfn.defence)
        p -= 0.26 * self.plant_active("chaos_spell", att.side)
        hp_mag = self.plant_active("press_switch", dfn.side)
        if hp_mag and x < 50:
            p -= 0.08 * hp_mag                       # forced errors in build-up against the high press
        p = clamp(p, 0.12, 0.975)
        self._pass_p = p
        self.tick(0.8 + dist / 16 + self.rng.uniform(0, 1.1) + (1 - att.style.tempo) * 1.0)
        if ptype == "through_ball" and self.rng.random() < 0.13:
            self.emit("pass", att, carrier, x, y, end_x=rx, end_y=ry, outcome="fail", recipient_id=pid, pass_type=ptype)
            self.emit("offside", att, pid, rx, ry)
            self.tick(self.rng.uniform(12, 20))
            fx, fy = mirror(rx, ry)
            return ("end", dfn, ("free_kick", fx, fy))
        if self.rng.random() < p:
            ev = self.emit("pass", att, carrier, x, y, end_x=rx, end_y=ry, outcome="success", recipient_id=pid, pass_type=ptype)
            self.last_pass = {"type": ptype, "recipient": pid, "event": ev["id"]}
            return ("continue", pid, ev["end_x"], ev["end_y"])
        # failed pass: intercepted, or out of play
        frac = self.rng.uniform(0.45, 0.95)
        ix, iy = x + (rx - x) * frac, y + (ry - y) * frac
        if self.rng.random() < 0.26:
            ox = clamp(rx + self.rng.uniform(-3, 6), 1, 104)
            oy = 0.3 if ry < 34 else 67.7
            if ox > 103 and ptype in ("long", "through_ball"):
                self.emit("pass", att, carrier, x, y, end_x=104.9, end_y=ry, outcome="fail", recipient_id=pid, pass_type=ptype)
                return ("end", dfn, ("goal_kick", 6.0, 34.0))
            self.emit("pass", att, carrier, x, y, end_x=ox, end_y=oy, outcome="fail", recipient_id=pid, pass_type=ptype)
            tx, ty = mirror(ox, oy)
            return ("end", dfn, ("throw_in", tx, ty))
        self.emit("pass", att, carrier, x, y, end_x=ix, end_y=iy, outcome="fail", recipient_id=pid, pass_type=ptype)
        dpid, _, _ = self.nearest_defender(att, ix, iy)
        mx, my = mirror(ix, iy)
        self.tick(0.8)
        # a clean interception, or a loose ball won back after the pass goes astray
        self.emit("interception" if self.rng.random() < 0.42 else "recovery", dfn, dpid, mx, my, outcome="success")
        return ("end", dfn, ("regain", mx, my, dpid))

    def dribble(self, att: TeamState, carrier: str, x: float, y: float, situation: str):
        dfn = self.other(att)
        player = att.by_id[carrier]
        dpid, dx, dy = self.nearest_defender(att, x, y)
        defender = dfn.by_id[dpid]
        p = 0.48 + (player.dribbling - 0.6) * 0.55 - (defender.defending - 0.6) * 0.35 - self.fatigue_penalty(att, carrier)
        tired_ch, tired_mag = self.tired_fullback_channel(att)
        if tired_mag and channel(y) == tired_ch:
            p += 0.18 * tired_mag
        self.tick(self.rng.uniform(1.5, 3))
        if self.rng.random() < clamp(p, 0.15, 0.85):
            nx, ny = clamp(x + self.rng.uniform(3, 8), 1, 98), clamp(y + self.rng.gauss(0, 4), 2, 66)
            self.emit("dribble", att, carrier, x, y, end_x=nx, end_y=ny, outcome="success")
            return ("continue", carrier, nx, ny)
        self.emit("dribble", att, carrier, x, y, outcome="fail")
        foul_p = (0.16 + 0.14 * self.intensity) * (1.5 if x > 75 else 1.0) * (0.85 if in_box(x, y) else 1.0)
        if self.rng.random() < foul_p:
            return ("end", att, self.foul(dfn, dpid, x, y))
        self.emit("tackle", dfn, dpid, *mirror(x, y), outcome="success")
        mx, my = mirror(x, y)
        return ("end", dfn, ("regain", mx, my, dpid))

    def cross(self, att: TeamState, carrier: str, x: float, y: float, situation: str):
        dfn = self.other(att)
        tx, ty = self.rng.uniform(91, 102), self.rng.uniform(25, 43)
        target = self.aerial_target(att, carrier)
        self.tick(self.rng.uniform(1.5, 2.5))
        p = 0.20 + 0.12 * att.style.crossing + 0.12 * att.attack - 0.12 * dfn.defence + 0.08 * att.by_id[carrier].passing
        self._pass_p = p
        if self.rng.random() < p:
            self.emit("pass", att, carrier, x, y, end_x=tx, end_y=ty, outcome="success", recipient_id=target, pass_type="cross")
            self.last_pass = {"type": "cross", "recipient": target}
            if self.rng.random() < 0.42:
                return ("end",) + self.shoot(att, target, tx, ty, situation, assist_type="cross", header=self.rng.random() < 0.62)
            return ("continue", target, tx, ty)
        self.emit("pass", att, carrier, x, y, end_x=tx, end_y=ty, outcome="fail", recipient_id=target, pass_type="cross")
        if self.rng.random() < 0.28:
            self.tick(self.rng.uniform(3, 6))
            return ("end", att, ("corner", 104.5, y))
        res = self.defensive_clear(att, tx, ty)
        if isinstance(res[0], TeamState):
            return ("end",) + res
        pid, nx, ny, _ = res
        return ("continue", pid, nx, ny)

    # ------------------------------------------------------------------ shooting

    def shoot(self, att: TeamState, shooter: str, x: float, y: float, situation: str, assist_type: str | None,
              header: bool = False, direct_free_kick: bool = False, restart_type: str | None = None,
              forced: str | None = None, own_goal_by: str | None = None):
        dfn = self.other(att)
        frame = self.freeze_frame(att, shooter, x, y)
        foot = att.traits[shooter].foot
        if header:
            body = "head"
        elif foot == "both":
            body = "right_foot" if self.rng.random() < 0.5 else "left_foot"
        else:
            body = f"{foot}_foot" if self.rng.random() < 0.82 else ("left_foot" if foot == "right" else "right_foot")
        tags = []
        if direct_free_kick:
            tags.append("direct_free_kick")
        if own_goal_by:
            tags.append("own_goal")
        if situation == "penalty":
            tags.append("penalty")
        probe = {"x": x, "y": y, "team_id": att.team_id, "body_part": body, "situation": situation,
                 "freeze_frame": frame, "tags": tags}
        xg = shot_xg(probe, assist_type)["xg"]
        if xg >= 0.3 and situation != "penalty":
            tags.append("big_chance")
        if restart_type == "free_kick":
            self.emit("free_kick", att, shooter, x, y, end_x=LENGTH, end_y=34, outcome="success", pass_type=None,
                      tags=["direct_shot"])
        finishing = att.by_id[shooter].finishing
        gk = dfn.by_id[dfn.gk()]
        p_goal = xg * (0.72 + 0.55 * finishing) * (1.12 - 0.22 * gk.defending) * self.scoring_multiplier(att)
        p_goal *= 1.0 - self.fatigue_penalty(att, shooter)
        p_goal *= 0.6 + 0.85 * min(self.match_minute(), 95) / 95   # real goals cluster late (fatigue, game state)
        p_goal = clamp(p_goal, 0.003, 0.93)
        self.tick(self.rng.uniform(1.2, 2.5))
        lane = sum(1 for p in frame if p["team_id"] != att.team_id and not p.get("gk")
                   and x < p["x"] and abs(p["y"] - (y + (34 - y) * (p["x"] - x) / max(LENGTH - x, 1))) < 2.2)
        r = self.rng.random()
        if self.conditioned and forced != "goal":
            p_goal = 0.0                 # real matches: only the real goals go in
        placement = dive = None
        end_y = clamp(34 + self.rng.gauss(0, 3), 28, 40)
        if situation == "penalty":
            # taker's placement vs the keeper's dive, both from the taker's point of view
            placement = sample(att.traits[shooter].penalty, self.rng)
            dive = sample(dfn.traits[dfn.gk()].gk_dive, self.rng)
            guessed = dive == placement
            if forced == "goal":
                if guessed and self.rng.random() < 0.65:
                    dive = self.rng.choice([d for d in ("left", "center", "right") if d != placement])
                outcome = "goal"
            elif self.conditioned:
                outcome = "saved" if guessed else ("post" if self.rng.random() < 0.3 else "off_target")
            else:
                p_pen = (0.3 if placement == "center" else 0.38) if guessed else 0.93
                outcome = "goal" if r < p_pen else ("saved" if guessed else ("post" if self.rng.random() < 0.3 else "off_target"))
            end_y = 34 + {"left": 2.6, "center": 0.0, "right": -2.6}[placement] + self.rng.uniform(-0.6, 0.6)
        elif forced == "goal" or r < p_goal:
            outcome = "goal"
        elif self.rng.random() < (0.10 + 0.07 * min(lane, 3)):
            outcome = "blocked"
        else:
            on_target = self.rng.random() < 0.37
            outcome = "saved" if on_target else ("post" if self.rng.random() < 0.06 else "off_target")
        shot = self.emit("shot", att, shooter, x, y, end_x=LENGTH, end_y=end_y,
                         outcome="success" if outcome == "goal" else "fail", body_part=body, situation=situation,
                         shot_outcome=outcome, xg=xg, freeze_frame=frame, tags=tags or None, own_goal_by=own_goal_by,
                         placement=placement, gk_dive=dive)
        if outcome == "goal":
            self.score[att.side] += 1
            shot["score"] = dict(self.score)
            if self.last_pass and self.last_pass.get("recipient") == shooter and self.last_pass.get("event") and not own_goal_by:
                shot["assist_event_id"] = self.last_pass["event"]
            celebrate = self.rng.uniform(55, 85)
            if self.schedule:
                nxt = self.schedule[0]
                nxt_t = (0.0 if nxt["period"] == 1 else FIRST_HALF + self.added[0] * 60) + nxt["elapsed"]
                if nxt["period"] == self.period:
                    celebrate = max(20.0, min(celebrate, nxt_t - self.t - 30))
            self.tick(celebrate)
            return dfn, ("kick_off", 52.5, 34.0)
        if outcome == "saved":
            self.tick(0.6)
            self.emit("save", dfn, gk.player_id, 2.0, 34.0, outcome="success")
            if self.rng.random() < 0.46:
                self.tick(self.rng.uniform(4, 8))
                return att, ("corner", 104.5, y)
            self.tick(self.rng.uniform(5, 12))
            return dfn, ("regain", 6.0, 34.0, gk.player_id)
        if outcome == "blocked":
            dpid, _, _ = self.nearest_defender(att, x + 3, y)
            self.emit("clearance", dfn, dpid, *mirror(x + 2, y), outcome="success", tags=["block"])
            if self.rng.random() < 0.5:
                return att, ("corner", 104.5, y)
            mx, my = mirror(x + 4, y)
            return dfn, ("regain", mx, my, dpid)
        return dfn, ("goal_kick", 6.0, 34.0)

    # ------------------------------------------------------------------ output

    def payload(self, match_id: str, meta: dict) -> dict:
        """Assemble the match document. `meta` carries the descriptive fields (real or what-if)."""
        home, away = self.home, self.away
        for e in self.events:
            e["match_id"] = match_id
        tags = list(meta.pop("scenario_tags", []))
        if self.scenario != "balanced":
            tags.append(self.scenario)
        if any(t["type"] == "red_card" for t in self.truth):
            tags.append("red_card")
        if self.score["home"] + self.score["away"] >= 5:
            tags.append("goals")
        p2_start = FIRST_HALF + self.added[0] * 60
        last_goal = max((e["t"] for e in self.events if e.get("shot_outcome") == "goal"), default=0)
        if last_goal and last_goal - p2_start >= 40 * 60:
            tags.append("late_goal")
        doc_meta = {
            "match_id": match_id,
            **meta,
            "home": home.club.payload(self._starting_formation(home)),
            "away": away.club.payload(self._starting_formation(away)),
            "final_score": dict(self.score),
            "duration_s": round(self.events[-1]["t"], 1),
            "scenario_tags": sorted(set(tags)),
            "seed": self.seed,
            "period_starts": [0, p2_start],
            "truth": {"scenario": self.scenario, "conditioned": self.conditioned, "labels": self.truth, "plants": self.plant_labels},
        }
        return {"meta": doc_meta, "events": self.events}

    def _starting_formation(self, team: TeamState) -> str:
        changes = [t for t in self.truth if t["type"] == "formation_change" and t["team_id"] == team.team_id]
        return changes[0]["from"] if changes else team.formation


def scenario_satisfied(match: dict, underdog_side: str | None = None) -> bool:
    """Story constraints for each what-if scenario, checked against the simulated outcome."""
    meta, events = match["meta"], match["events"]
    scenario = meta["truth"]["scenario"]
    fs = meta["final_score"]
    goals = [e for e in events if e.get("shot_outcome") == "goal"]
    if scenario == "comeback":
        trailing = set()
        for g in goals:
            s = g["score"]
            if s["home"] < s["away"]:
                trailing.add("home")
            if s["away"] < s["home"]:
                trailing.add("away")
        return any(fs[side] > fs["away" if side == "home" else "home"] for side in trailing)
    if scenario == "late_drama":
        p2 = meta["period_starts"][1]
        late = [g for g in goals if g["t"] - p2 >= 40 * 60]
        if not late:
            return False
        g = late[-1]
        return abs(g["score"]["home"] - g["score"]["away"]) <= 1
    if scenario == "red_card":
        return any(t["type"] == "red_card" for t in meta["truth"]["labels"])
    if scenario == "goal_fest":
        return fs["home"] + fs["away"] >= 5
    if scenario == "tactical_chess":
        return fs["home"] + fs["away"] <= 2 and sum(1 for e in events if e["type"] == "shot") <= 22
    if scenario == "underdog" and underdog_side:
        return fs[underdog_side] > fs["away" if underdog_side == "home" else "home"]
    if scenario == "derby":
        return sum(1 for e in events if e["type"] == "card") >= 5
    return True
