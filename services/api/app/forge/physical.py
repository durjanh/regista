"""Physical model (MODEL data): distance covered, sprints and top speed per player in 15-minute windows.

Event data has no tracking, so physical output is modelled from what drives it in real football: role (a central
midfielder covers ~11.5 km, a centre-back ~10 km), the player's work rate, how involved he is in each phase
(touches and pressing actions), time on the pitch (decline after the hour, steeper with low stamina) and altitude
for teams that are not acclimatised. The dugout uses the drop between a player's first and latest windows to flag fatigue.
"""

from __future__ import annotations

import hashlib
from collections import defaultdict

from .traits import altitude_fatigue, traits_for

KM90 = {"GK": 5.3, "CB": 9.9, "RB": 10.8, "LB": 10.8, "RWB": 11.1, "LWB": 11.1, "DM": 11.3, "CM": 11.7,
        "AM": 11.1, "RW": 10.7, "LW": 10.7, "ST": 10.2}
SPRINTS90 = {"GK": 1, "CB": 16, "RB": 30, "LB": 30, "RWB": 34, "LWB": 34, "DM": 18, "CM": 22, "AM": 26,
             "RW": 36, "LW": 36, "ST": 30}
INVOLVEMENT = {"pass", "carry", "dribble", "shot", "tackle", "interception", "pressure", "recovery", "clearance"}


def windows(meta: dict, end_t: float) -> list[tuple[float, float]]:
    p2 = meta.get("period_starts", [0, 2700])[1]
    return [(0, 900), (900, 1800), (1800, p2), (p2, p2 + 900), (p2 + 900, p2 + 1800), (p2 + 1800, max(end_t, p2 + 1801))]


def on_pitch_intervals(meta: dict, events: list[dict], end_t: float) -> dict[str, list[float]]:
    on: dict[str, list[float]] = {}
    for side in ("home", "away"):
        for p in meta[side]["players"]:
            if p["starter"]:
                on[p["player_id"]] = [0.0, end_t]
    for e in events:
        if e["type"] == "substitution":
            if e["sub_out"] in on:
                on[e["sub_out"]][1] = e["t"]
            on[e["sub_in"]] = [e["t"], end_t]
        elif e.get("card") in ("red", "second_yellow") and e.get("player_id") in on:
            on[e["player_id"]][1] = e["t"]
    return on


def compute(doc: dict) -> dict:
    meta, events = doc["meta"], doc["events"]
    end_t = events[-1]["t"] if events else 5700.0
    wins = windows(meta, end_t)
    intervals = on_pitch_intervals(meta, events, end_t)
    venue = meta.get("venue_info") or {}
    acclimatised = set(venue.get("acclimatised", []))
    players = {p["player_id"]: p for side in ("home", "away") for p in meta[side]["players"]}

    involvement: dict[tuple[str, int], int] = defaultdict(int)
    for e in events:
        if e["type"] in INVOLVEMENT and e.get("player_id"):
            w = next((i for i, (a, b) in enumerate(wins) if a <= e["t"] < b), len(wins) - 1)
            involvement[(e["player_id"], w)] += 1
    team_avg: dict[tuple[str, int], float] = {}
    for w in range(len(wins)):
        for tid in (meta["home"]["team_id"], meta["away"]["team_id"]):
            vals = [involvement[(pid, w)] for pid, p in players.items() if p["team_id"] == tid and pid in intervals
                    and p["position"] != "GK" and intervals[pid][0] < wins[w][1] and intervals[pid][1] > wins[w][0]]
            team_avg[(tid, w)] = (sum(vals) / len(vals)) if vals else 1.0

    planted_fatigue = {pl["player_id"]: pl for pl in (meta.get("truth") or {}).get("plants", [])
                       if pl.get("mechanism") == "tiring_fullback" and pl.get("player_id")}
    mag_of = {"obvious": 1.0, "moderate": 0.75, "subtle": 0.5}
    out = {}
    for pid, (t_on, t_off) in intervals.items():
        p = players.get(pid)
        if not p:
            continue
        tr = traits_for(p.get("player_key") or pid, p["position"])
        plant = planted_fatigue.get(pid)
        alt = altitude_fatigue(venue.get("altitude_m"), p["team_id"] in acclimatised)
        km90 = KM90.get(p["position"], 10.5) * tr.work_rate
        spr90 = SPRINTS90.get(p["position"], 24) * tr.work_rate * (tr.pace_kmh / 32.0)
        by_km, by_spr, by_min = [], [], []
        for w, (a, b) in enumerate(wins):
            overlap = max(0.0, min(b, t_off) - max(a, t_on))
            by_min.append(round(overlap / 60, 1))
            if overlap <= 0:
                by_km.append(0.0)
                by_spr.append(0)
                continue
            mins_on_mid = ((max(a, t_on) + min(b, t_off)) / 2 - t_on) / 60
            decline = max(0.55, 1 - 0.034 * max(0.0, (mins_on_mid - 30) / 15) * (2 - tr.stamina) * alt)
            if p["position"] == "GK":
                decline = 1 - (1 - decline) * 0.25          # keepers barely fade
            rel = involvement[(pid, w)] / max(team_avg.get((p["team_id"], w), 1.0), 0.5) if p["position"] != "GK" else 1.0
            factor = 1 + 0.09 * max(-1.0, min(1.0, rel - 1))
            km = km90 / 5400 * overlap * decline * factor
            spr = spr90 / 5400 * overlap * (decline ** 1.8) * factor
            by_km.append(round(km, 2))
            by_spr.append(round(spr))
        # 5-minute blocks (sprints and km), the resolution the dugout and the tiring detector need
        km5, spr5 = [], []
        for b0 in range(0, int(end_t) + 1, 300):
            b1 = b0 + 300
            overlap = max(0.0, min(b1, t_off) - max(b0, t_on))
            if overlap <= 0:
                km5.append(0.0)
                spr5.append(0.0)
                continue
            mins_on_mid = ((max(b0, t_on) + min(b1, t_off)) / 2 - t_on) / 60
            decline = max(0.55, 1 - 0.034 * max(0.0, (mins_on_mid - 30) / 15) * (2 - tr.stamina) * alt)
            if p["position"] == "GK":
                decline = 1 - (1 - decline) * 0.25
            if plant and (b0 + b1) / 2 >= plant["t"]:
                decline *= 1 - 0.32 * mag_of.get(plant.get("difficulty", "obvious"), 1.0)
            noise = 1 + (int(hashlib.sha1(f"{pid}{b0}".encode()).hexdigest()[:4], 16) / 65535 - 0.5) * 0.12
            km5.append(round(km90 / 5400 * overlap * decline * noise, 3))
            spr5.append(round(spr90 / 5400 * overlap * (decline ** 2.2) * noise, 2))
        jitter = int(hashlib.sha1(f"{pid}{meta['match_id']}".encode()).hexdigest()[:4], 16) / 65535
        if plant:
            by_km = [round(sum(km5[i] for i in range(len(km5)) if a <= i * 300 < b), 2) for (a, b) in wins]
        out[pid] = {"by_15": by_km, "sprints_by_15": by_spr, "mins_by_15": by_min, "minutes": round((t_off - t_on) / 60),
                    "km_by_5": km5, "sprints_by_5": spr5,
                    "top_speed_kmh": round(tr.pace_kmh - 0.8 + 1.2 * jitter - (0.6 if alt > 1 else 0.0), 1),
                    "on": [t_on, t_off]}
    return out


def upto(phys: dict, meta: dict, t: float, end_t: float) -> dict:
    """Distance, sprints and per-window splits up to match time t (partial current window)."""
    wins = windows(meta, end_t)
    out = {}
    for pid, d in phys.items():
        t_on, t_off = d["on"]
        if t_on > t:
            continue
        km, mins = [], []
        spr = 0.0
        for w, (a, b) in enumerate(wins):
            full = max(0.0, min(b, t_off) - max(a, t_on))
            part = max(0.0, min(b, t_off, t) - max(a, t_on))
            if full <= 0 or part <= 0:
                km.append(0.0)
                mins.append(0.0)
                continue
            frac = part / full
            km.append(round(d["by_15"][w] * frac, 2))
            mins.append(round(part / 60, 1))
            spr += d["sprints_by_15"][w] * frac
        rates = [(k / m) for k, m in zip(km, mins) if m >= 4]          # km per minute in windows with enough minutes
        first = rates[0] * 15 if rates else 0.0
        last = rates[-1] * 15 if rates else 0.0
        out[pid] = {"by_15": km, "mins_by_15": mins, "distance_km": round(sum(km), 2), "sprints": round(spr),
                    "top_speed_kmh": d["top_speed_kmh"], "minutes": round((min(t, t_off) - t_on) / 60),
                    "first15_km": round(first, 2), "last15_km": round(last, 2),
                    "drop_pct": round((first - last) / first * 100, 1) if first and len(rates) > 1 else 0.0}
    return out
