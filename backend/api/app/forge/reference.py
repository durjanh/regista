"""Real football reference data: 49,945 men's international results (1872–2026), goalscorers and shootouts.

Source: github.com/martj42/international_results (Kaggle: martj42/international-football-results-from-1872-to-2017),
licensed CC0-1.0. Used for:
- real match facts (teams, date, tournament, city, score, scorers, minutes, penalties, own goals, assists),
- Elo ratings computed chronologically over every result (team strength for the simulator and win-probability prior),
- a goal-rate model fitted to real scorelines (expected goals as a function of Elo gap),
- real squads (players who scored or assisted for that country around the match date),
- head-to-head records and the calibration reference for the synthetic engine.
"""

from __future__ import annotations

import bisect
import csv
import math
import os
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import date
from functools import lru_cache
from pathlib import Path

from .teams import (
    ARCHETYPES,
    ATTACK_ORDER,
    BENCH_POSITIONS,
    FORMATIONS,
    POSITION_FAMILY,
    PlayerProfile,
    TeamProfile,
    archetype_for,
)

DATASET = {
    "name": "International football results from 1872 to 2026",
    "source": "github.com/martj42/international_results (Kaggle: martj42/international-football-results-from-1872-to-2017)",
    "licence": "CC0-1.0",
}

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_DIR = REPO_ROOT / "data" / "reference" / "international-results"

MAJOR_FINALS = {"UEFA Euro", "Copa América", "African Cup of Nations", "AFC Asian Cup", "Gold Cup",
                "CONCACAF Championship", "Confederations Cup", "Oceania Nations Cup"}

# Kit colours and FIFA codes are public facts about national teams; teams not listed get a deterministic palette.
TEAM_COLORS = {
    "England": ("#FFFFFF", "#CE1124", "#0B1F3A"), "Argentina": ("#75AADB", "#FFFFFF", "#0B1F3A"),
    "France": ("#21304D", "#ED2939", "#FFFFFF"), "Spain": ("#C60B1E", "#FFC400", "#FFFFFF"),
    "Germany": ("#FFFFFF", "#000000", "#000000"), "Brazil": ("#FEDD00", "#009C3B", "#002776"),
    "Portugal": ("#C8102E", "#046A38", "#FFFFFF"), "Netherlands": ("#F36C21", "#FFFFFF", "#1A1A1A"),
    "Italy": ("#0064AA", "#FFFFFF", "#FFFFFF"), "Belgium": ("#E30613", "#FDDA24", "#FFFFFF"),
    "Croatia": ("#FFFFFF", "#D2001F", "#171796"), "Mexico": ("#006847", "#FFFFFF", "#FFFFFF"),
    "United States": ("#FFFFFF", "#0A3161", "#0A3161"), "Japan": ("#0B2A7A", "#FFFFFF", "#FFFFFF"),
    "Saudi Arabia": ("#FFFFFF", "#006C35", "#006C35"), "Norway": ("#BA0C2F", "#00205B", "#FFFFFF"),
    "Morocco": ("#C1272D", "#006233", "#FFFFFF"), "Uruguay": ("#5CBFEB", "#000000", "#0B1F3A"),
    "Colombia": ("#FCD116", "#003893", "#003893"), "Switzerland": ("#D52B1E", "#FFFFFF", "#FFFFFF"),
    "Senegal": ("#FFFFFF", "#00853F", "#00853F"), "Scotland": ("#0B2341", "#FFFFFF", "#FFFFFF"),
    "Wales": ("#C8102E", "#00B140", "#FFFFFF"), "Republic of Ireland": ("#169B62", "#FFFFFF", "#FFFFFF"),
    "Denmark": ("#C60C30", "#FFFFFF", "#FFFFFF"), "Sweden": ("#FECC02", "#006AA7", "#006AA7"),
    "Australia": ("#FFCD00", "#00843D", "#00843D"), "South Korea": ("#C60C30", "#003478", "#FFFFFF"),
    "Canada": ("#D80621", "#FFFFFF", "#FFFFFF"), "Ecuador": ("#FFD100", "#034EA2", "#034EA2"),
    "Austria": ("#ED2939", "#FFFFFF", "#FFFFFF"), "Turkey": ("#E30A17", "#FFFFFF", "#FFFFFF"),
    "Ghana": ("#FFFFFF", "#006B3F", "#000000"), "Egypt": ("#CE1126", "#FFFFFF", "#FFFFFF"),
    "Poland": ("#FFFFFF", "#DC143C", "#DC143C"), "Serbia": ("#C6363C", "#0C4076", "#FFFFFF"),
    "Iran": ("#FFFFFF", "#239F40", "#DA0000"), "Algeria": ("#FFFFFF", "#006233", "#006233"),
    "Ivory Coast": ("#F77F00", "#009E60", "#FFFFFF"), "Nigeria": ("#008751", "#FFFFFF", "#FFFFFF"),
    "Cameroon": ("#007A5E", "#CE1126", "#FCD116"), "Tunisia": ("#E70013", "#FFFFFF", "#FFFFFF"),
    "Paraguay": ("#D52B1E", "#0038A8", "#FFFFFF"), "Chile": ("#D52B1E", "#0039A6", "#FFFFFF"),
    "Peru": ("#FFFFFF", "#D91023", "#D91023"), "Ukraine": ("#FFD500", "#005BBB", "#005BBB"),
    "Czech Republic": ("#D7141A", "#11457E", "#FFFFFF"), "Hungary": ("#CE2939", "#477050", "#FFFFFF"),
    "Qatar": ("#8A1538", "#FFFFFF", "#FFFFFF"), "South Africa": ("#FFB612", "#007749", "#007749"),
    "Cape Verde": ("#003893", "#CF2027", "#FFFFFF"), "DR Congo": ("#007FFF", "#CE1021", "#FFFFFF"),
    "Bosnia and Herzegovina": ("#002395", "#FECB00", "#FFFFFF"), "New Zealand": ("#FFFFFF", "#000000", "#000000"),
    "Jordan": ("#FFFFFF", "#CE1126", "#007A3D"), "Iraq": ("#FFFFFF", "#007A3D", "#CE1126"),
    "Uzbekistan": ("#FFFFFF", "#1EB53A", "#0099B5"), "Panama": ("#DA121A", "#072357", "#FFFFFF"),
    "Haiti": ("#00209F", "#D21034", "#FFFFFF"), "Curaçao": ("#002B7F", "#F9E814", "#FFFFFF"),
}
FIFA_CODES = {
    "England": "ENG", "Argentina": "ARG", "France": "FRA", "Spain": "ESP", "Germany": "GER", "Brazil": "BRA",
    "Portugal": "POR", "Netherlands": "NED", "Italy": "ITA", "Belgium": "BEL", "Croatia": "CRO", "Mexico": "MEX",
    "United States": "USA", "Japan": "JPN", "Saudi Arabia": "KSA", "Norway": "NOR", "Morocco": "MAR",
    "Uruguay": "URU", "Colombia": "COL", "Switzerland": "SUI", "Senegal": "SEN", "Scotland": "SCO", "Wales": "WAL",
    "Republic of Ireland": "IRL", "Denmark": "DEN", "Sweden": "SWE", "Australia": "AUS", "South Korea": "KOR",
    "Canada": "CAN", "Ecuador": "ECU", "Austria": "AUT", "Turkey": "TUR", "Ghana": "GHA", "Egypt": "EGY",
    "Poland": "POL", "Serbia": "SRB", "Iran": "IRN", "Algeria": "ALG", "Ivory Coast": "CIV", "Nigeria": "NGA",
    "Cameroon": "CMR", "Tunisia": "TUN", "Paraguay": "PAR", "Chile": "CHI", "Peru": "PER", "Ukraine": "UKR",
    "Czech Republic": "CZE", "Hungary": "HUN", "Qatar": "QAT", "South Africa": "RSA", "Cape Verde": "CPV",
    "DR Congo": "COD", "Bosnia and Herzegovina": "BIH", "New Zealand": "NZL", "Jordan": "JOR", "Iraq": "IRQ",
    "Uzbekistan": "UZB", "Panama": "PAN", "Haiti": "HAI", "Curaçao": "CUW", "Costa Rica": "CRC",
}

# Real matches featured on the hub. All 90-minute games (no extra time) with complete goal records.
FEATURED = [
    ("2026-07-15", "England", "Argentina"),
    ("2026-07-18", "France", "England"),
    ("2026-07-05", "Mexico", "England"),
    ("2026-07-05", "Brazil", "Norway"),
    ("2026-07-14", "France", "Spain"),
    ("2024-07-14", "Spain", "England"),
    ("2024-07-10", "Netherlands", "England"),
    ("2022-11-22", "Argentina", "Saudi Arabia"),
    ("2022-11-23", "Germany", "Japan"),
]


def slug(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def player_key(team_id: str, name: str | None, shirt: int) -> str:
    return f"{team_id}:{slug(name)}" if name else f"{team_id}:no-{shirt}"


def _palette(name: str) -> dict:
    if name in TEAM_COLORS:
        p, s, t = TEAM_COLORS[name]
    else:
        h = sum(ord(c) * (i + 1) for i, c in enumerate(name)) % 360
        p, s, t = f"hsl({h} 62% 42%)", "#FFFFFF", "#FFFFFF"
    return {"primary": p, "secondary": s, "text": t}


def _k_factor(tournament: str) -> int:
    if tournament == "FIFA World Cup":
        return 60
    if "qualification" in tournament:
        return 40
    if tournament in MAJOR_FINALS:
        return 50
    if "Nations League" in tournament:
        return 40
    if tournament == "Friendly":
        return 20
    return 30


def _gd_multiplier(gd: int) -> float:
    gd = abs(gd)
    if gd <= 1:
        return 1.0
    if gd == 2:
        return 1.5
    if gd == 3:
        return 1.75
    return 1.75 + (gd - 3) / 8


def _years_between(a: str, b: str) -> float:
    da, db = date.fromisoformat(a), date.fromisoformat(b)
    return abs((db - da).days) / 365.25


class ReferenceData:
    def __init__(self, directory: str | os.PathLike | None = None):
        self.dir = Path(directory or os.environ.get("REGISTA_REFERENCE_DIR") or DEFAULT_DIR)
        self.former: dict[str, str] = {}
        fn = self.dir / "former_names.csv"
        if fn.exists():
            for r in csv.DictReader(open(fn, encoding="utf-8")):
                self.former[r["former"]] = r["current"]
        self.results: list[dict] = []
        for r in csv.DictReader(open(self.dir / "results.csv", encoding="utf-8")):
            if r["home_score"] in ("NA", ""):
                continue
            self.results.append({
                "date": r["date"], "home_team": self.current(r["home_team"]), "away_team": self.current(r["away_team"]),
                "home_score": int(r["home_score"]), "away_score": int(r["away_score"]), "tournament": r["tournament"],
                "city": r["city"], "country": r["country"], "neutral": r["neutral"].upper() == "TRUE",
            })
        self.results.sort(key=lambda r: r["date"])
        self.goals: dict[tuple, list[dict]] = defaultdict(list)
        self.goal_rows: list[dict] = []
        for r in csv.DictReader(open(self.dir / "goalscorers.csv", encoding="utf-8")):
            g = {"date": r["date"], "home_team": self.current(r["home_team"]), "away_team": self.current(r["away_team"]),
                 "team": self.current(r["team"]), "scorer": r["scorer"],
                 "minute": int(float(r["minute"])) if r["minute"] not in ("NA", "") else None,
                 "own_goal": r["own_goal"].upper() == "TRUE", "penalty": r["penalty"].upper() == "TRUE",
                 "assist": r.get("assist") if r.get("assist") not in (None, "", "NA") else None}
            self.goals[(g["date"], g["home_team"], g["away_team"])].append(g)
            self.goal_rows.append(g)
        self.shootouts: dict[tuple, str] = {}
        so = self.dir / "shootouts.csv"
        if so.exists():
            for r in csv.DictReader(open(so, encoding="utf-8")):
                self.shootouts[(r["date"], self.current(r["home_team"]), self.current(r["away_team"]))] = self.current(r["winner"])
        self.positions: dict[tuple[str, str], str] = {}
        pos_file = self.dir.parent / "player_positions.csv"
        if pos_file.exists():
            for r in csv.DictReader(open(pos_file, encoding="utf-8")):
                self.positions[(r["team"], r["name"])] = r["position"]
        self.names: dict[str, str] = {}
        for r in self.results:
            self.names.setdefault(slug(r["home_team"]), r["home_team"])
            self.names.setdefault(slug(r["away_team"]), r["away_team"])
        self._compute_elo()
        self._fit_goal_model()
        self._index_players()

    # ------------------------------------------------------------------ basics

    def current(self, name: str) -> str:
        return self.former.get(name, name)

    def career_goal_number(self, scorer: str, team: str, date: str, minute: int | None) -> int:
        """Which international goal this was for the scorer (own goals excluded): 1 for his first. 0 if unknown."""
        if not hasattr(self, "_career"):
            career: dict[tuple, list] = defaultdict(list)
            for g in self.goal_rows:
                if not g["own_goal"]:
                    career[(g["scorer"], g["team"])].append((g["date"], g["minute"] or 0))
            self._career = {k: sorted(v) for k, v in career.items()}
        goals = self._career.get((scorer, self.current(team)), [])
        return bisect.bisect_right(goals, (date, minute or 0))

    def name_of(self, team_id: str) -> str:
        if team_id not in self.names:
            raise KeyError(team_id)
        return self.names[team_id]

    def colors(self, name: str) -> dict:
        return _palette(name)

    def short(self, name: str) -> str:
        return FIFA_CODES.get(name, re.sub(r"[^A-Z]", "", name.upper())[:3] or name[:3].upper())

    def latest_date(self) -> str:
        """A date just after the last result, for 'as of today' team profiles."""
        return f"{self.results[-1]['date'][:4]}-12-31"

    def find_result(self, d: str, home: str, away: str) -> dict | None:
        home, away = self.current(home), self.current(away)
        for r in self.results:
            if r["date"] == d and r["home_team"] == home and r["away_team"] == away:
                return r
        return None

    def goals_for(self, result: dict) -> list[dict]:
        return sorted(self.goals.get((result["date"], result["home_team"], result["away_team"]), []),
                      key=lambda g: (g["minute"] or 0))

    # ------------------------------------------------------------------ Elo

    def _compute_elo(self) -> None:
        rating: dict[str, float] = defaultdict(lambda: 1500.0)
        self.elo_hist: dict[str, list[tuple[str, float]]] = defaultdict(list)
        self.pre_elo: dict[tuple, tuple[float, float]] = {}
        for r in self.results:
            h, a = r["home_team"], r["away_team"]
            rh, ra = rating[h], rating[a]
            self.pre_elo[(r["date"], h, a)] = (rh, ra)
            dr = rh - ra + (0 if r["neutral"] else 100)
            we = 1 / (10 ** (-dr / 400) + 1)
            gd = r["home_score"] - r["away_score"]
            w = 1.0 if gd > 0 else 0.5 if gd == 0 else 0.0
            delta = _k_factor(r["tournament"]) * _gd_multiplier(gd) * (w - we)
            rating[h], rating[a] = rh + delta, ra - delta
            self.elo_hist[h].append((r["date"], rating[h]))
            self.elo_hist[a].append((r["date"], rating[a]))
        self.elo_now = dict(rating)
        self.last_played = {t: hist[-1][0] for t, hist in self.elo_hist.items()}

    def elo_before(self, team: str, d: str) -> float:
        hist = self.elo_hist.get(team)
        if not hist:
            return 1500.0
        i = bisect.bisect_left([h[0] for h in hist], d)
        return hist[i - 1][1] if i > 0 else 1500.0

    def form(self, team: str, d: str, n: int = 20) -> dict:
        games = [r for r in self.results if r["date"] < d and team in (r["home_team"], r["away_team"])][-n:]
        if not games:
            return {"gf": 1.4, "ga": 1.2, "played": 0}
        gf = sum(r["home_score"] if r["home_team"] == team else r["away_score"] for r in games) / len(games)
        ga = sum(r["away_score"] if r["home_team"] == team else r["home_score"] for r in games) / len(games)
        return {"gf": gf, "ga": ga, "played": len(games)}

    # ------------------------------------------------------------------ goal model (fitted to real scorelines)

    def _fit_goal_model(self) -> None:
        """log(lambda_home) = a_h + b_h * dr and log(lambda_away) = a_a + b_a * dr, fitted on binned real results."""
        bins: dict[int, list[tuple[int, int]]] = defaultdict(list)
        for r in self.results:
            if r["date"] < "2000-01-01" or r["tournament"] == "Friendly":
                continue
            rh, ra = self.pre_elo[(r["date"], r["home_team"], r["away_team"])]
            dr = rh - ra + (0 if r["neutral"] else 100)
            if abs(dr) > 700:
                continue
            bins[int(round(dr / 50) * 50)].append((r["home_score"], r["away_score"]))

        def fit(idx: int) -> tuple[float, float]:
            xs, ys, ws = [], [], []
            for b, games in bins.items():
                if len(games) < 30:
                    continue
                m = sum(g[idx] for g in games) / len(games)
                if m <= 0:
                    continue
                xs.append(b)
                ys.append(math.log(m))
                ws.append(len(games))
            sw = sum(ws)
            mx = sum(w * x for w, x in zip(ws, xs)) / sw
            my = sum(w * y for w, y in zip(ws, ys)) / sw
            b = sum(w * (x - mx) * (y - my) for w, x, y in zip(ws, xs, ys)) / sum(w * (x - mx) ** 2 for w, x in zip(ws, xs))
            return my - b * mx, b

        self.goal_model = {"home": fit(0), "away": fit(1), "fitted_on": sum(len(v) for v in bins.values())}

    def expected_goals(self, elo_home: float, elo_away: float, neutral: bool) -> tuple[float, float]:
        dr = elo_home - elo_away + (0 if neutral else 100)
        ah, bh = self.goal_model["home"]
        aa, ba = self.goal_model["away"]
        return math.exp(ah + bh * dr), math.exp(aa + ba * dr)

    # ------------------------------------------------------------------ players (real names from scorer records)

    def _index_players(self) -> None:
        self.player_events: dict[str, list[tuple[str, str, str]]] = defaultdict(list)  # team -> (date, name, kind)
        for g in self.goal_rows:
            if g["own_goal"]:
                continue
            self.player_events[g["team"]].append((g["date"], g["scorer"], "goal"))
            if g["assist"]:
                self.player_events[g["team"]].append((g["date"], g["assist"], "assist"))
        for t in self.player_events:
            self.player_events[t].sort()

    def player_pool(self, team: str, d: str, years: float = 4.0) -> list[dict]:
        """Players who scored or assisted for `team` in the `years` before `d` (plus 60 days after), recency weighted."""
        lo = str(int(d[:4]) - int(years)) + d[4:]
        hi_year = int(d[:4]) + (1 if d[5:7] >= "11" else 0)
        hi = f"{hi_year}{d[4:]}" if hi_year == int(d[:4]) else f"{hi_year}-01-31"
        if d[5:7] < "11":
            m = int(d[5:7]) + 2
            hi = f"{d[:4]}-{m:02d}{d[7:]}"
        score: dict[str, float] = defaultdict(float)
        goals: Counter = Counter()
        assists: Counter = Counter()
        for (when, name, kind) in self.player_events.get(team, []):
            if lo <= when <= hi:
                w = 1 / (1 + _years_between(when, d))
                score[name] += w * (1.0 if kind == "goal" else 0.7)
                (goals if kind == "goal" else assists)[name] += 1
        return sorted(({"name": n, "score": s, "goals": goals[n], "assists": assists[n]} for n, s in score.items()),
                      key=lambda p: -p["score"])

    def known_position(self, team: str, name: str) -> str | None:
        return self.positions.get((team, name))

    def build_squad(self, team: str, d: str, formation: str, team_id: str, must_include: list[str],
                    attack: float, defence: float) -> list[PlayerProfile]:
        """Starting XI and bench from players recorded as scoring/assisting for `team` around date `d`.

        Positions come from a curated table of publicly known positions (data/reference/player_positions.csv);
        players not in it are placed by scoring profile. Slots nobody fits get a shirt-number placeholder."""
        pool = self.player_pool(team, d)
        names = [p["name"] for p in pool]
        for n in must_include:
            if n not in names:
                pool.insert(0, {"name": n, "score": 0.5, "goals": 0, "assists": 0})
                names.insert(0, n)
        for p in pool:
            p["pos"] = self.known_position(team, p["name"])
        slots = FORMATIONS[formation]
        assigned: dict[int, dict | None] = {0: None}
        used: set[str] = set()

        def take(i: int, cands: list[dict]) -> bool:
            for p in cands:
                if p["name"] not in used:
                    assigned[i] = p
                    used.add(p["name"])
                    return True
            return False

        # who must start: real scorers/assisters of this match, then the best of the rest
        must = [p for p in pool if p["name"] in must_include]
        ranked = must + [p for p in pool if p["name"] not in must_include]
        outfield = [i for i in range(1, len(slots))]
        # pass 1: exact known position; pass 2: same family; pass 3: unknown positions by attacking order
        for i in sorted(outfield, key=lambda i: ATTACK_ORDER.index(slots[i][0])):
            pos = slots[i][0]
            take(i, [p for p in ranked if p["pos"] == pos and p["name"] in must_include]) or \
                take(i, [p for p in ranked if p["pos"] == pos])
        for i in outfield:
            if i in assigned:
                continue
            fam = POSITION_FAMILY[slots[i][0]]
            take(i, [p for p in ranked if p["pos"] and POSITION_FAMILY[p["pos"]] == fam and p["name"] in must_include]) or \
                take(i, [p for p in ranked if p["pos"] and POSITION_FAMILY[p["pos"]] == fam])
        # real scorers of this match must be on the pitch: put them in their own position family first
        for p in must:
            if p["name"] in used:
                continue
            fam = POSITION_FAMILY[p["pos"]] if p["pos"] else None
            same = [i for i in outfield if fam and POSITION_FAMILY[slots[i][0]] == fam]
            open_same = [i for i in same if i not in assigned]
            swap_same = [i for i in same if assigned.get(i) and assigned[i]["name"] not in must_include]
            open_any = [i for i in outfield if i not in assigned and (not fam or POSITION_FAMILY[slots[i][0]] in ("FWD", "WIDE", "AM", "MID"))]
            target = (open_same[0] if open_same else
                      min(swap_same, key=lambda i: assigned[i]["score"]) if swap_same else
                      open_any[0] if open_any else
                      min((i for i in outfield if assigned.get(i) and assigned[i]["name"] not in must_include
                           and POSITION_FAMILY[slots[i][0]] not in ("DEF", "GK")), key=lambda i: assigned[i]["score"], default=None))
            if target is None:
                continue
            if assigned.get(target):
                used.discard(assigned[target]["name"])
            assigned[target] = p
            used.add(p["name"])
        # pass 4: compatible families (an attacking midfielder can play centrally or wide, a full-back at wing-back...)
        compatible = {"MID": ("AM",), "AM": ("MID", "WIDE", "FWD"), "WIDE": ("AM", "FWD", "WB"),
                      "FWD": ("AM", "WIDE"), "WB": ("DEF", "WIDE"), "DEF": ("WB",)}
        for i in sorted([i for i in outfield if i not in assigned], key=lambda i: ATTACK_ORDER.index(slots[i][0])):
            fam = POSITION_FAMILY[slots[i][0]]
            take(i, [p for p in ranked if p["pos"] and POSITION_FAMILY[p["pos"]] in compatible.get(fam, ())]) or \
                (fam not in ("DEF", "WB", "GK") and take(i, [p for p in ranked if not p["pos"]]))   # unknown scorers are rarely defenders
        bench_named = [p for p in ranked if p["name"] not in used][:6]
        default_shirt = {"GK": 1, "RB": 2, "LB": 3, "CB": 5, "DM": 4, "CM": 8, "AM": 10, "RW": 7, "LW": 11,
                         "ST": 9, "RWB": 2, "LWB": 3}
        used_shirts: set[int] = set()

        def shirt_for(pos: str) -> int:
            s = default_shirt[pos]
            while s in used_shirts:
                s += 12 if s < 12 else 1
            used_shirts.add(s)
            return s

        def attrs(p: dict | None, pos: str) -> dict:
            g = p["goals"] if p else 0
            a = p["assists"] if p else 0
            fam_att = pos in ("ST", "LW", "RW", "AM")
            return {
                "passing": min(0.95, 0.45 + 0.35 * attack + 0.03 * a),
                "finishing": min(0.95, (0.35 if fam_att else 0.15) + 0.35 * attack + 0.015 * g),
                "dribbling": min(0.95, (0.45 if fam_att else 0.35) + 0.3 * attack),
                "defending": min(0.95, (0.25 if fam_att else 0.45) + 0.4 * defence),
                "stamina": 0.72,
            }

        players: list[PlayerProfile] = []
        for i in range(len(slots)):
            pos = slots[i][0]
            p = assigned.get(i)
            shirt = shirt_for(pos)
            name = p["name"] if p else f"{team} No. {shirt}"
            players.append(PlayerProfile(
                player_id=f"{team_id}-{i + 1:02d}", team_id=team_id, name=name, shirt=shirt, position=pos, starter=True,
                name_source="dataset" if p else "placeholder", goals_in_window=p["goals"] if p else 0,
                assists_in_window=p["assists"] if p else 0, player_key=player_key(team_id, name if p else None, shirt),
                **attrs(p, pos)))
        for j, pos in enumerate(BENCH_POSITIONS):
            p = None
            if pos != "GK":
                fam = POSITION_FAMILY[pos]
                p = next((b for b in bench_named if b["pos"] and POSITION_FAMILY[b["pos"]] == fam), None) or \
                    next((b for b in bench_named if not b["pos"]), None)
                if p:
                    bench_named.remove(p)
                    pos = p["pos"] or pos
            shirt = shirt_for(pos)
            name = p["name"] if p else f"{team} No. {shirt}"
            players.append(PlayerProfile(
                player_id=f"{team_id}-{len(slots) + j + 1:02d}", team_id=team_id, name=name, shirt=shirt, position=pos,
                starter=False, name_source="dataset" if p else "placeholder", goals_in_window=p["goals"] if p else 0,
                assists_in_window=p["assists"] if p else 0, player_key=player_key(team_id, name if p else None, shirt),
                **attrs(p, pos)))
        return players

    # ------------------------------------------------------------------ team profiles

    def team_profile(self, team: str, d: str, opponent: str, home: bool, neutral: bool,
                     must_include: list[str] | None = None, formation: str | None = None) -> TeamProfile:
        elo = self.elo_before(team, d)
        opp_elo = self.elo_before(opponent, d)
        f = self.form(team, d)
        attack = max(0.3, min(0.95, 0.42 + (elo - 1500) / 900 + 0.06 * (f["gf"] - 1.5)))
        defence = max(0.3, min(0.95, 0.42 + (elo - 1500) / 900 - 0.06 * (f["ga"] - 1.1)))
        arch = archetype_for(elo, opp_elo, home, neutral)
        label, default_formation, style = ARCHETYPES[arch]
        formation = formation or default_formation
        tid = slug(team)
        squad = self.build_squad(team, d, formation, tid, must_include or [], attack, defence)
        return TeamProfile(team_id=tid, name=team, short=self.short(team), elo=elo, attack=attack, defence=defence,
                           formation=formation, style=style, colors=self.colors(team), squad=squad, archetype=arch,
                           seed=sum(ord(c) for c in team))

    # ------------------------------------------------------------------ head to head, team detail, summary

    def h2h(self, a: str, b: str, before: str | None = None) -> dict:
        games = [r for r in self.results if {r["home_team"], r["away_team"]} == {a, b} and (before is None or r["date"] < before)]
        aw = sum(1 for r in games if (r["home_team"] == a and r["home_score"] > r["away_score"]) or (r["away_team"] == a and r["away_score"] > r["home_score"]))
        bw = sum(1 for r in games if (r["home_team"] == b and r["home_score"] > r["away_score"]) or (r["away_team"] == b and r["away_score"] > r["home_score"]))
        ag = sum(r["home_score"] if r["home_team"] == a else r["away_score"] for r in games)
        bg = sum(r["home_score"] if r["home_team"] == b else r["away_score"] for r in games)
        return {"played": len(games), "home_wins": aw, "draws": len(games) - aw - bw, "away_wins": bw,
                "home_goals": ag, "away_goals": bg,
                "last": [{k: r[k] for k in ("date", "home_team", "away_team", "home_score", "away_score", "tournament")}
                         for r in games[-5:][::-1]]}

    def ranking(self, active_since: str = "2023-01-01", limit: int | None = None) -> list[dict]:
        rows = [(t, e) for t, e in self.elo_now.items() if self.last_played.get(t, "") >= active_since]
        rows.sort(key=lambda r: -r[1])
        out = []
        for i, (t, e) in enumerate(rows[: limit or len(rows)]):
            out.append({"team_id": slug(t), "name": t, "elo": round(e), "rank": i + 1,
                        "played": len(self.elo_hist[t]), "colors": self.colors(t)})
        return out

    def team_detail(self, team_id: str) -> dict:
        team = self.name_of(team_id)
        games = [r for r in self.results if team in (r["home_team"], r["away_team"])]
        won = sum(1 for r in games if (r["home_team"] == team and r["home_score"] > r["away_score"]) or (r["away_team"] == team and r["away_score"] > r["home_score"]))
        lost = sum(1 for r in games if (r["home_team"] == team and r["home_score"] < r["away_score"]) or (r["away_team"] == team and r["away_score"] < r["home_score"]))
        gf = sum(r["home_score"] if r["home_team"] == team else r["away_score"] for r in games)
        ga = sum(r["away_score"] if r["home_team"] == team else r["home_score"] for r in games)
        hist = self.elo_hist[team]
        sampled, last_year = [], None
        for d, e in hist:
            if d[:4] != last_year:
                sampled.append({"date": d, "elo": round(e)})
                last_year = d[:4]
        sampled.extend({"date": d, "elo": round(e)} for d, e in hist[-20:] if d > sampled[-1]["date"])
        recent = []
        for r in games[-10:][::-1]:
            home = r["home_team"] == team
            recent.append({"date": r["date"], "opponent": r["away_team"] if home else r["home_team"],
                           "gf": r["home_score"] if home else r["away_score"], "ga": r["away_score"] if home else r["home_score"],
                           "tournament": r["tournament"], "city": r["city"]})
        scorers = Counter(g["scorer"] for g in self.goal_rows if g["team"] == team and not g["own_goal"])
        rank = next((x["rank"] for x in self.ranking() if x["team_id"] == team_id), None)
        return {"team_id": team_id, "name": team, "colors": self.colors(team), "elo": round(self.elo_now.get(team, 1500)),
                "rank": rank, "elo_history": sampled,
                "record": {"played": len(games), "won": won, "drawn": len(games) - won - lost, "lost": lost, "gf": gf, "ga": ga},
                "recent": recent, "top_scorers": [{"name": n, "goals": c} for n, c in scorers.most_common(10)]}

    def summary(self) -> dict:
        teams = {t for r in self.results for t in (r["home_team"], r["away_team"])}
        return {"matches": len(self.results), "first_date": self.results[0]["date"], "last_date": self.results[-1]["date"],
                "teams": len(teams), "goals_recorded": len(self.goal_rows), "shootouts": len(self.shootouts),
                "source": DATASET["source"], "licence": DATASET["licence"], "name": DATASET["name"]}

    # ------------------------------------------------------------------ calibration reference (real distributions)

    def calibration_reference(self, since: str = "1990-01-01") -> dict:
        comp = [r for r in self.results if r["date"] >= since and r["tournament"] != "Friendly"]
        nn = [r for r in comp if not r["neutral"]]
        goals = [r["home_score"] + r["away_score"] for r in comp]
        gs = [g for g in self.goal_rows if g["date"] >= since and g["minute"]]
        bins = Counter(min((g["minute"] - 1) // 15, 5) for g in gs if g["minute"] >= 1)
        tot = sum(bins.values())
        scores = Counter(f"{min(r['home_score'], 5)}-{min(r['away_score'], 5)}" for r in nn)
        return {
            "matches": len(comp),
            "goals_per_match": sum(goals) / len(goals),
            "draw_rate": sum(1 for r in comp if r["home_score"] == r["away_score"]) / len(comp),
            "home_win_rate": sum(1 for r in nn if r["home_score"] > r["away_score"]) / len(nn),
            "penalty_share": sum(1 for g in gs if g["penalty"]) / len(gs),
            "own_goal_share": sum(1 for g in gs if g["own_goal"]) / len(gs),
            "late_goal_share": sum(1 for g in gs if g["minute"] > 75) / len(gs),
            "goal_minute_bins": {i: bins[i] / tot for i in range(6)},
            "scorelines": {k: v / len(nn) for k, v in scores.most_common(10)},
        }


@lru_cache(maxsize=1)
def reference() -> ReferenceData:
    return ReferenceData()
