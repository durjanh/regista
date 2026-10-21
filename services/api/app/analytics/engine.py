"""Match analysis: turns an event stream (up to any point in time) into the `Analysis` contract."""

from __future__ import annotations

import bisect
import math

from ..forge.reference import reference
from .moments import detect_moments
from .stats import player_stats, shot_list, team_stats
from .tactics import team_tactics
from .winprob import win_prob


def with_physical(rows: list[dict], doc: dict, t: float, end_t: float) -> list[dict]:
    """Attach modelled distance and sprints (and the stable player key) to player stat rows."""
    from ..forge import physical
    phys = physical.upto(doc.get("physical") or {}, doc["meta"], t, end_t) if doc.get("physical") else {}
    keys = {p["player_id"]: p.get("player_key") for s in ("home", "away") for p in doc["meta"][s]["players"]}
    for r in rows:
        ph = phys.get(r["player_id"])
        if ph:
            r["distance_km"], r["sprints"], r["top_speed_kmh"] = ph["distance_km"], ph["sprints"], ph["top_speed_kmh"]
        if keys.get(r["player_id"]):
            r["player_key"] = keys[r["player_id"]]
    return rows


def neutral_venue(meta: dict) -> bool:
    real = (meta.get("source") or {}).get("real")
    if real is not None:
        return bool(real.get("neutral"))
    return meta.get("venue", "").lower().startswith("neutral")


def priors(meta: dict) -> tuple[float, float]:
    elo = meta.get("elo") or {"home": 1500, "away": 1500}
    return reference().expected_goals(elo["home"], elo["away"], neutral_venue(meta))


def minute_of(t: float, meta: dict) -> int:
    p2 = meta.get("period_starts", [0, 2700])[1]
    if t < p2:
        return min(45, int(t // 60) + 1)
    return min(90, 45 + int((t - p2) // 60) + 1)


def elapsed_regulation(t: float, meta: dict) -> float:
    """Seconds of a 95-minute match that have elapsed, used by the win-probability model."""
    p2 = meta.get("period_starts", [0, 2700])[1]
    if t < p2:
        return min(t, 47 * 60)
    return 47 * 60 + (t - p2)


class MatchAnalyzer:
    def __init__(self, doc: dict):
        self.doc = doc
        self.meta = doc["meta"]
        self.events = doc["events"]
        self.ts = [e["t"] for e in self.events]
        self.home = self.meta["home"]["team_id"]
        self.away = self.meta["away"]["team_id"]
        self.prior = priors(self.meta)
        self._full: dict | None = None
        # cumulative state per event index for fast win-probability lookups
        self.cum = []
        sh = sa = 0
        xh = xa = 0.0
        rh = ra = 0
        for e in self.events:
            if e["type"] == "shot":
                if e["team_id"] == self.home:
                    xh += e.get("xg", 0)
                else:
                    xa += e.get("xg", 0)
            if e.get("card") in ("red", "second_yellow"):
                if e["team_id"] == self.home:
                    rh += 1
                else:
                    ra += 1
            sh, sa = e["score"]["home"], e["score"]["away"]
            self.cum.append((sh, sa, xh, xa, rh, ra))

    @property
    def end_t(self) -> float:
        return self.events[-1]["t"] if self.events else 0.0

    def events_upto(self, upto_t: float | None) -> list[dict]:
        if upto_t is None:
            return self.events
        return self.events[: bisect.bisect_right(self.ts, upto_t)]

    def state_at(self, t: float) -> tuple:
        i = bisect.bisect_right(self.ts, t) - 1
        return self.cum[i] if i >= 0 else (0, 0, 0.0, 0.0, 0, 0)

    def wp_at(self, t: float) -> dict:
        sh, sa, xh, xa, rh, ra = self.state_at(t)
        return win_prob(self.prior[0], self.prior[1], elapsed_regulation(t, self.meta), sh, sa, xh, xa, rh, ra)

    def win_prob_series(self, upto_t: float) -> list[dict]:
        out = [{"minute": 0, "t": 0.0, **self.wp_at(0)}]
        p2 = self.meta.get("period_starts", [0, 2700])[1]
        t = 60.0
        while t <= upto_t:
            out.append({"minute": minute_of(t - 1, self.meta), "t": t, **self.wp_at(t)})
            t += 60.0
            if t > p2 - 60 and t < p2:
                t = p2
        if out[-1]["t"] < upto_t:
            out.append({"minute": minute_of(upto_t, self.meta), "t": upto_t, **self.wp_at(upto_t)})
        return out

    def momentum_series(self, events: list[dict]) -> list[dict]:
        """Causal exponentially-weighted threat share per minute: +1 home dominant, -1 away dominant."""
        last_minute = max((minute_of(e["t"], self.meta) + (e.get("added_minute") or 0) * 0 for e in events), default=0)
        threat = {}
        for e in events:
            m = minute_of(e["t"], self.meta)
            v = max(e.get("xt_added", 0.0), 0.0) + (0.6 * e.get("xg", 0.0) if e["type"] == "shot" else 0.0)
            if v:
                h, a = threat.get(m, (0.0, 0.0))
                threat[m] = (h + v, a) if e["team_id"] == self.home else (h, a + v)
        out, eh, ea = [], 0.0, 0.0
        decay = math.exp(-1 / 4.0)
        for m in range(1, last_minute + 1):
            h, a = threat.get(m, (0.0, 0.0))
            eh, ea = eh * decay + h, ea * decay + a
            value = math.tanh(2.2 * (eh - ea) / max(eh + ea, 0.25)) * min(1.0, (eh + ea) / 0.4)
            out.append({"minute": m, "value": round(value, 3)})
        return out

    def xg_timeline(self, events: list[dict]) -> list[dict]:
        out, h, a = [{"minute": 0, "home": 0.0, "away": 0.0}], 0.0, 0.0
        for e in events:
            if e["type"] == "shot":
                if e["team_id"] == self.home:
                    h += e.get("xg", 0)
                else:
                    a += e.get("xg", 0)
                out.append({"minute": e["minute"] + (e.get("added_minute") or 0), "home": round(h, 2), "away": round(a, 2)})
        return out

    def control_chaos(self, events: list[dict]) -> list[dict]:
        """0 = one side in control (long possessions, accurate passing), 1 = chaos (possession flipping, low completion)."""
        flips, passes, ok, last = {}, {}, {}, None
        for e in events:
            m = minute_of(e["t"], self.meta) + (e.get("added_minute") or 0) * 0
            if e["type"] in ("pass", "carry", "dribble", "shot"):
                if last and e["team_id"] != last:
                    flips[m] = flips.get(m, 0) + 1
                last = e["team_id"]
            if e["type"] == "pass":
                passes[m] = passes.get(m, 0) + 1
                ok[m] = ok.get(m, 0) + (e.get("outcome") == "success")
        last_minute = max(passes) if passes else 0
        out, prev = [], 0.3
        for m in range(1, last_minute + 1):
            f = flips.get(m, 0)
            comp = ok.get(m, 0) / passes[m] if passes.get(m) else 0.85
            raw = min(1.0, max(0.0, (f - 1.0) / 4.0)) * 0.65 + min(1.0, max(0.0, (0.95 - comp) / 0.4)) * 0.35
            prev = prev * 0.6 + raw * 0.4
            out.append({"minute": m, "value": round(prev, 3)})
        return out

    @staticmethod
    def pass_profile(events: list[dict], team_id: str) -> dict:
        ps = [e for e in events if e["team_id"] == team_id and e["type"] == "pass" and "pass_length" in e]
        if not ps:
            return {"avg_length": 0.0, "long_share": 0.0, "avg_difficulty": 0.0, "completion_by_difficulty": []}
        bands = []
        for band, lo, hi in (("easy", 0.0, 0.2), ("medium", 0.2, 0.45), ("hard", 0.45, 1.01)):
            b = [e for e in ps if lo <= e.get("difficulty", 0.2) < hi]
            bands.append({"band": band, "attempts": len(b), "completion": round(sum(1 for e in b if e["outcome"] == "success") / len(b), 3) if b else 0.0})
        return {"avg_length": round(sum(e["pass_length"] for e in ps) / len(ps), 1),
                "long_share": round(sum(1 for e in ps if e["pass_length"] > 30) / len(ps), 3),
                "avg_difficulty": round(sum(e.get("difficulty", 0) for e in ps) / len(ps), 3), "completion_by_difficulty": bands}

    def insights(self, upto_t: float | None = None) -> list[dict]:
        if not hasattr(self, "_insight_engine"):
            from .insights import InsightEngine
            self._insight_engine = InsightEngine(self.doc)
        return self._insight_engine.insights(upto_t)

    def snapshot(self, upto_t: float) -> dict:
        """Light-weight state for the live stream."""
        ev = self.events_upto(upto_t)
        mom = self.momentum_series(ev)
        score = ev[-1]["score"] if ev else {"home": 0, "away": 0}
        cc = self.control_chaos(ev)
        return {"t": upto_t, "minute": minute_of(upto_t, self.meta), "score": score,
                "momentum": mom[-1]["value"] if mom else 0.0, "win_prob": self.wp_at(upto_t),
                "control_chaos": cc[-1]["value"] if cc else 0.3,
                "stats": {"home": team_stats(ev, self.home, self.away), "away": team_stats(ev, self.away, self.home)}}

    def moments(self, upto_t: float | None = None) -> list[dict]:
        t = self.end_t if upto_t is None else upto_t
        ev = self.events_upto(t)
        final = t >= self.end_t
        tac = {side: team_tactics(ev, self.meta, side, t)["shifts"] for side in ("home", "away")}
        shifts = {side: [{**s, "t": 0} for s in items] for side, items in tac.items()}
        return detect_moments(ev, self.meta, self.wp_at, self.momentum_series(ev), shifts, final)

    def analyze(self, upto_t: float | None = None) -> dict:
        full = upto_t is None or upto_t >= self.end_t
        if full and self._full is not None:
            return self._full
        t = self.end_t if full else upto_t
        ev = self.events_upto(t)
        tactics = {side: team_tactics(ev, self.meta, side, t) for side in ("home", "away")}
        shifts = {side: [{**s, "t": 0} for s in tactics[side]["shifts"]] for side in ("home", "away")}
        momentum = self.momentum_series(ev)
        moments = detect_moments(ev, self.meta, self.wp_at, momentum, shifts, full)
        players = with_physical(player_stats(ev, self.meta, t), self.doc, t, self.end_t)
        result = {
            "match_id": self.meta["match_id"], "t": t, "minute": minute_of(t, self.meta),
            "score": ev[-1]["score"] if ev else {"home": 0, "away": 0},
            "stats": {"home": team_stats(ev, self.home, self.away), "away": team_stats(ev, self.away, self.home)},
            "momentum": momentum,
            "win_prob": self.win_prob_series(t),
            "xg_timeline": self.xg_timeline(ev),
            "shots": shot_list(ev),
            "moments": moments,
            "tactics": tactics,
            "top_players": players[:6],
            "prior": {"home_xg": round(self.prior[0], 2), "away_xg": round(self.prior[1], 2)},
            "control_chaos": self.control_chaos(ev),
            "pass_profile": {"home": self.pass_profile(ev, self.home), "away": self.pass_profile(ev, self.away)},
        }
        if full:
            self._full = result
        return result
