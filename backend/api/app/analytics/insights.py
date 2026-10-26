"""Tactical-change detectors: structured insights from the event stream alone.

Code detects, AI explains. Each detector builds a per-minute feature series, finds the change point with a
two-segment fit (the same idea as KQL `series_fit_2lines`), and only reports a change once enough evidence has
accumulated *after* it, so `detected_minute` has no look-ahead and holds for live use. Every insight carries the series, the change
point, before/after levels and the KQL a Verifier would re-run on the Eventhouse.

Mechanisms: press_switch, shape_change, tiring_fullback, hot_streak, set_piece_routine, chaos_spell.
"""

from __future__ import annotations

import math

from .geometry import WIDTH, channel
from .tactics import formation_in_window, line_sizes

MIN_SEG = 6
DEFENSIVE_ACTIONS = ("pressure", "tackle", "interception", "recovery")
FULLBACKS = ("RB", "LB", "RWB", "LWB")


def minute_index(t: float, p2: float) -> int:
    """0-based index of real elapsed minutes (first-half stoppage keeps its own minutes; no overlap with the second half)."""
    return int(t // 60)


def smooth(values: list[float], w: int = 3) -> list[float]:
    out = []
    for i in range(len(values)):
        lo = max(0, i - w + 1)
        out.append(sum(values[lo:i + 1]) / (i + 1 - lo))
    return out


def two_segment(v: list[float], min_seg: int = MIN_SEG) -> tuple[int, float, float, float] | None:
    """Best split k (mean before vs after) by least squares; returns (k, mean_before, mean_after, t_stat)."""
    n = len(v)
    if n < 2 * min_seg:
        return None
    cs, cs2 = [0.0], [0.0]
    for x in v:
        cs.append(cs[-1] + x)
        cs2.append(cs2[-1] + x * x)
    best = None
    for k in range(min_seg, n - min_seg + 1):
        nb, na = k, n - k
        sb, sa = cs[k], cs[n] - cs[k]
        qb, qa = cs2[k], cs2[n] - cs2[k]
        sse = (qb - sb * sb / nb) + (qa - sa * sa / na)
        if best is None or sse < best[0]:
            best = (sse, k, sb / nb, sa / na, qb / nb - (sb / nb) ** 2, qa / na - (sa / na) ** 2)
    _, k, mb, ma, vb, va = best
    se = math.sqrt(max(vb, 1e-6) / k + max(va, 1e-6) / (n - k))
    return k, mb, ma, (ma - mb) / se


def detections(raw: list[float], direction: int, min_abs: float, min_rel: float, t_min: float,
               start_after: int = 24, window: int = 8, skip: tuple[int, int] | None = None,
               cooldown: int = 14) -> list[tuple[int, int, float, float, float]]:
    """Detection without look-ahead: at each minute L compare the last `window` minutes with the baseline before them
    (z-test on the difference of means). Every confident shift is reported once (then a cooldown), with its change
    point refined by a two-segment fit over the surrounding half hour. Returns [(detected_index, change_index, before, after, z)]."""
    n = len(raw)
    out: list[tuple[int, int, float, float, float]] = []
    floor = 0
    L = max(start_after, window + 12)
    while L < n:
        if skip and skip[0] <= L - window <= skip[1]:
            L += 1
            continue                                  # the window straddles half-time: wait for clean second-half minutes
        recent = raw[L - window + 1:L + 1]
        base = raw[max(floor, L - window - 30):L - window + 1]
        if len(base) < 10:
            L += 1
            continue
        mb, mr = sum(base) / len(base), sum(recent) / window
        vb = sum((x - mb) ** 2 for x in base) / max(1, len(base) - 1)
        se = math.sqrt(max(vb, 0.15) * (1 / window + 1 / len(base)))
        z = (mr - mb) / se
        diff = (mr - mb) * direction
        if diff >= min_abs and diff >= min_rel * max(abs(mb), 0.05) and z * direction >= t_min:
            lo = max(0, L - 30)
            seg = two_segment(smooth(raw[lo:L + 1]), min_seg=4)
            k = lo + seg[0] if seg else L - window + 1
            k = max(k, L - window - 4)
            out.append((L, k, mb, mr, abs(z)))
            floor = L                                 # the next baseline starts after this change
            L += cooldown
            continue
        L += 1
    return out


def ratio_detections(num: list[float], den: list[float], direction: int, min_abs: float, min_rel: float, z_min: float,
                     start_after: int = 22, window: int = 8, skip: tuple[int, int] | None = None, cooldown: int = 14,
                     min_den: float = 12) -> list[tuple[int, int, float, float, float]]:
    """Like `detections`, but on a rate num/den (e.g. pressing actions per opponent build-up pass), with a
    two-proportion z-test, so swings in possession don't masquerade as tactical changes."""
    n = len(num)
    out = []
    floor = 0
    L = max(start_after, window + 12)
    while L < n:
        if skip and skip[0] <= L - window <= skip[1]:
            L += 1
            continue
        r0, r1 = L - window + 1, L + 1
        b0 = max(floor, L - window - 30)
        nr, dr = sum(num[r0:r1]), sum(den[r0:r1])
        nb, db = sum(num[b0:r0]), sum(den[b0:r0])
        if dr < min_den or db < 2 * min_den or (r0 - b0) < 10:
            L += 1
            continue
        pb, pr = nb / db, nr / dr
        pool = (nb + nr) / (db + dr)
        se = math.sqrt(max(pool * (1 - min(pool, 0.99)), 0.01) * (1 / db + 1 / dr))
        z = (pr - pb) / se
        diff = (pr - pb) * direction
        if diff >= min_abs and diff >= min_rel * max(pb, 0.02) and z * direction >= z_min:
            lo = max(0, L - 30)
            rate = [num[i] / den[i] if den[i] else 0.0 for i in range(lo, L + 1)]
            seg = two_segment(smooth(rate), min_seg=4)
            k = max(lo + seg[0] if seg else r0, L - window - 4)
            out.append((L, k, round(pb, 3), round(pr, 3), abs(z)))
            floor = L
            L += cooldown
            continue
        L += 1
    return out


def first_detection(raw: list[float], direction: int, **kw) -> tuple[int, int, float, float, float] | None:
    found = detections(raw, direction, **kw)
    return found[0] if found else None


class InsightEngine:
    def __init__(self, doc: dict):
        self.doc = doc
        self.meta = doc["meta"]
        self.events = doc["events"]
        self.p2 = self.meta.get("period_starts", [0, 2700])[1]
        self.halftime = (int(2600 // 60), int(self.p2 // 60) + 4)
        self.names = {p["player_id"]: p for s in ("home", "away") for p in self.meta[s]["players"]}
        self._cache: dict[int, list[dict]] = {}

    def _minute_t(self, idx: int) -> float:
        return (idx + 1) * 60.0

    def _display_minute(self, idx: int) -> int:
        t = idx * 60.0 + 30
        if t < self.p2:
            return min(45, int(t // 60) + 1)
        return min(90, 45 + int((t - self.p2) // 60) + 1)

    # ------------------------------------------------------------------ public

    def insights(self, upto_t: float | None = None) -> list[dict]:
        end_t = self.events[-1]["t"] if self.events else 0
        t = end_t if upto_t is None else min(upto_t, end_t)
        n = minute_index(t, self.p2) + 1
        if n in self._cache:
            return self._cache[n]
        ev = [e for e in self.events if e["t"] <= t]
        out: list[dict] = []
        for side in ("home", "away"):
            out += self._press(ev, side, n)
            out += self._fullbacks(ev, side, n)
            out += self._hot_streaks(ev, side, n)
            out += self._set_pieces(ev, side, n)
            out += self._shape(ev, side, t)
        out += self._chaos(ev, n)
        out.sort(key=lambda i: i["detected_t"])
        self._cache[n] = out
        return out

    # ------------------------------------------------------------------ helpers

    def _series(self, ev: list[dict], n: int, pred) -> list[float]:
        v = [0.0] * n
        for e in ev:
            if pred(e):
                i = minute_index(e["t"], self.p2)
                if i < n:
                    v[i] += 1
        return v

    def _insight(self, mechanism: str, team_id: str, direction: str, det: tuple, series: list[float], label: str, unit: str,
                 query: str, title: str, text: str, evidence_ids: list[str], player: dict | None = None) -> dict:
        d_idx, k, before, after, tstat = det
        sm = smooth(series)
        conf = round(min(0.99, 0.5 + tstat / 12), 2)
        iid = f"in-{mechanism}-{team_id}-{player['player_id'] if player else 'team'}-{k}"
        ins = {
            "id": iid, "match_id": self.meta["match_id"], "team_id": team_id, "mechanism": mechanism, "direction": direction,
            "start_minute": self._display_minute(k), "detected_minute": self._display_minute(d_idx), "detected_t": self._minute_t(d_idx),
            "confidence": conf, "title": title, "text": text,
            "feature": {"name": mechanism, "label": label, "unit": unit,
                        "series": [{"minute": i + 1, "value": round(x, 2)} for i, x in enumerate(sm[:d_idx + 1])],
                        "change_minute": self._display_minute(k), "before": round(before, 2), "after": round(after, 2), "query": query},
            "evidence": [{"fact_id": f"{iid}:before", "label": f"{label} before {self._display_minute(k)}'", "value": round(before, 2)},
                         {"fact_id": f"{iid}:after", "label": f"{label} after {self._display_minute(k)}'", "value": round(after, 2),
                          "event_ids": evidence_ids[:12]},
                         {"fact_id": f"{iid}:conf", "label": "Detector confidence", "value": conf}],
        }
        if player:
            ins["player_id"], ins["player_name"] = player["player_id"], player["name"]
        return ins

    def _team(self, side: str) -> dict:
        return self.meta[side]

    # ------------------------------------------------------------------ detectors

    def _press(self, ev: list[dict], side: str, n: int) -> list[dict]:
        team = self._team(side)
        tid = team["team_id"]

        def pred(e):
            return e["team_id"] == tid and e["type"] in DEFENSIVE_ACTIONS and e["x"] >= 52.5
        raw = self._series(ev, n, pred)
        opp_id = self._team("away" if side == "home" else "home")["team_id"]
        den = self._series(ev, n, lambda e: e["team_id"] == opp_id and e["type"] == "pass" and e["x"] < 52.5)
        rate_series = [raw[i] / den[i] if den[i] else 0.0 for i in range(n)]
        out = []
        for direction, sign in (("higher", 1), ("lower", -1)):
            for det in ratio_detections(raw, den, sign, min_abs=0.09, min_rel=0.6, z_min=3.7, skip=self.halftime):
                k = det[1]
                ids = [e["id"] for e in ev if pred(e) and minute_index(e["t"], self.p2) >= k][:12]
                q = (f'match_events | where match_id == "{self.meta["match_id"]}" and team_id == "{tid}" '
                     f'and type in ("pressure","tackle","interception","recovery") and x >= 52.5\n'
                     '| make-series actions = count() default = 0 on minute from 0 to 100 step 1\n'
                     '| extend (rsquare, split_idx, variance, rvariance, line_fit) = series_fit_2lines(actions)')
                verb = "pressing higher" if sign > 0 else "dropping off"
                out.append(self._insight("press_switch", tid, direction, det, rate_series, "Pressing actions per opponent build-up pass", "ratio", q,
                                         f"{team['name']} {verb} from {self._display_minute(k)}'",
                                         f"{team['name']} are {verb}: pressing actions and regains in the opponent half went from "
                                         f"{det[2]:.2f} to {det[3]:.2f} per opponent build-up pass from {self._display_minute(k)}'.", ids))
        return out

    def _fullbacks(self, ev: list[dict], side: str, n: int) -> list[dict]:
        team = self._team(side)
        opp = self._team("away" if side == "home" else "home")
        out = []
        appeared = {p["player_id"] for p in team["players"] if p["starter"]} | {e["sub_in"] for e in ev if e["type"] == "substitution"}
        by_flank: dict[str, str] = {}
        for p in team["players"]:
            if p["position"] in FULLBACKS and p["player_id"] in appeared:
                flank = "left" if p["position"] in ("RB", "RWB") else "right"
                if flank not in by_flank or p["starter"]:
                    by_flank[flank] = p["player_id"]
        for pid in by_flank.values():
            p = self.names[pid]
            target = "left" if p["position"] in ("RB", "RWB") else "right"     # the attackers' channel this full-back defends

            def pred(e, target=target):
                if e["team_id"] != opp["team_id"]:
                    return False
                if e["type"] in ("pass", "carry") and e.get("outcome") == "success" and e.get("end_x", 0) >= 70 and channel(e.get("end_y", 34)) == target:
                    return True
                if e["type"] == "dribble" and e["x"] >= 60 and channel(e["y"]) == target:
                    return True
                return e["type"] == "pass" and e.get("pass_type") == "cross" and channel(e["y"]) == target
            raw = self._series(ev, n, pred)
            all_att = self._series(ev, n, lambda e: e["team_id"] == opp["team_id"] and (
                (e["type"] in ("pass", "carry") and e.get("outcome") == "success" and e.get("end_x", 0) >= 70)
                or (e["type"] == "dribble" and e["x"] >= 60) or (e["type"] == "pass" and e.get("pass_type") == "cross")))
            for det in ratio_detections(raw, all_att, 1, min_abs=0.12, min_rel=0.35, z_min=2.6, skip=self.halftime, min_den=6):
                run_drop = self._sprint_drop(pid, det[1], det[0])
                if run_drop is None or run_drop < 0.22:
                    continue
                k = det[1]
                ids = [e["id"] for e in ev if pred(e) and minute_index(e["t"], self.p2) >= k][:12]
                side_name = "right" if p["position"] in ("RB", "RWB") else "left"
                q = (f'match_events | where match_id == "{self.meta["match_id"]}" and team_id == "{opp["team_id"]}" '
                     f'and end_x >= 70 and end_y {">" if target == "left" else "<"} {WIDTH * 2 / 3 if target == "left" else WIDTH / 3:.1f}\n'
                     '| make-series attacks = count() default = 0 on minute from 0 to 100 step 1\n'
                     '| extend (rsquare, split_idx, variance, rvariance, line_fit) = series_fit_2lines(attacks)')
                share = [raw[i] / all_att[i] if all_att[i] else 0.0 for i in range(n)]
                ins = self._insight("tiring_fullback", team["team_id"], "fading", det, share,
                                    f"Share of {opp['name']} attacks down {p['name']}'s flank", "share", q,
                                    f"{p['name']} is tiring and being targeted",
                                    f"{opp['name']} are going after {p['name']} on {team['name']}'s {side_name}: the share of their attacks into his zone rose from "
                                    f"{round(det[2] * 100)}% to {round(det[3] * 100)}% from {self._display_minute(k)}', while his sprint rate fell "
                                    f"{round(run_drop * 100)}%.", ids, p)
                ins["evidence"].append({"fact_id": f"{ins['id']}:sprints", "label": f"{p['name']} sprint-rate drop", "value": f"{round(run_drop * 100)}%"})
                out.append(ins)
        return out

    def _sprint_drop(self, pid: str, change_idx: int, detected_idx: int) -> float | None:
        """Relative drop in a player's sprint rate (5-minute blocks) after `change_idx` vs his own earlier blocks."""
        ph = (self.doc.get("physical") or {}).get(pid)
        if not ph or "sprints_by_5" not in ph:
            return None
        blocks = ph["sprints_by_5"]
        cut, end = (change_idx * 60) // 300, (detected_idx * 60 + 60) // 300
        before = [x for x in blocks[:cut] if x > 0]
        after = [x for x in blocks[cut:end + 1] if x > 0]
        if len(before) < 3 or not after:
            return None
        b, a = sum(before) / len(before), sum(after) / len(after)
        return (b - a) / b if b else None

    def _hot_streaks(self, ev: list[dict], side: str, n: int) -> list[dict]:
        team = self._team(side)
        shots_by: dict[str, list[dict]] = {}
        for e in ev:
            if e["team_id"] == team["team_id"] and e["type"] == "shot" and e.get("situation") != "penalty" and e.get("player_id"):
                shots_by.setdefault(e["player_id"], []).append(e)
        out = []
        for pid, shots in shots_by.items():
            if len(shots) < 4:
                continue
            # rolling 12-minute window: at least 4 shots and 0.8 xG, well above the player's own rate before it
            for i in range(len(shots)):
                window = [s for s in shots if 0 <= s["t"] - shots[i]["t"] <= 12 * 60]
                xg = sum(s.get("xg", 0) for s in window)
                if (len(window) >= 4 and xg >= 0.6) or (len(window) >= 3 and xg >= 0.9):
                    start = minute_index(shots[i]["t"], self.p2)
                    det_idx = minute_index(window[min(3, len(window) - 1)]["t"], self.p2)
                    prior = [s for s in shots if s["t"] < shots[i]["t"]]
                    prior_rate = sum(s.get("xg", 0) for s in prior) / max(start, 1)
                    after_rate = xg / 12
                    if after_rate < 3.0 * max(prior_rate, 0.012):
                        continue
                    raw = [0.0] * n
                    for s in shots:
                        j = minute_index(s["t"], self.p2)
                        if j < n:
                            raw[j] += s.get("xg", 0)
                    det = (det_idx, start, round(prior_rate, 3), round(after_rate, 3), 5.0)
                    p = self.names[pid]
                    q = (f'match_events | where match_id == "{self.meta["match_id"]}" and player_id == "{pid}" and type == "shot"\n'
                         '| make-series xg = sum(xg) default = 0 on minute from 0 to 100 step 1\n'
                         '| extend rolling = series_fir(xg, repeat(1, 12), false)')
                    out.append(self._insight("hot_streak", team["team_id"], "up", det, raw, f"{p['name']} xG per minute", "xG/min", q,
                                             f"{p['name']} on a hot streak",
                                             f"{p['name']} has {len(window)} shots worth {xg:.2f} xG since {self._display_minute(start)}', "
                                             f"far above his earlier rate of {prior_rate:.2f} xG per minute.", [s["id"] for s in window], p))
                    break
        return out

    def _set_pieces(self, ev: list[dict], side: str, n: int) -> list[dict]:
        team = self._team(side)
        corners = [e for e in ev if e["team_id"] == team["team_id"] and e["type"] == "corner" and "end_x" in e]

        def near_post(e):
            post = 30.34 if e["y"] < 34 else 37.66
            return e["end_x"] >= 98 and abs(e["end_y"] - post) <= 1.9
        run = []
        for e in corners:
            run = run + [e] if near_post(e) else []
            before = [c for c in corners if c["t"] < run[0]["t"]] if run else []
            need = 2 if len(before) >= 2 else 3          # with no history, a pattern needs three in a row
            if len(run) >= need:
                share_before = sum(near_post(c) for c in before) / len(before) if before else 0.0
                if share_before <= 0.34:
                    start = minute_index(run[0]["t"], self.p2)
                    d_idx = minute_index(run[need - 1]["t"], self.p2)
                    raw = [0.0] * n
                    for c in corners:
                        j = minute_index(c["t"], self.p2)
                        if j < n:
                            raw[j] = 1.0 if near_post(c) else 0.3
                    det = (d_idx, start, round(share_before, 2), 1.0, 5.0)
                    q = (f'match_events | where match_id == "{self.meta["match_id"]}" and team_id == "{team["team_id"]}" and type == "corner"\n'
                         '| extend near_post = end_x >= 98 and abs(end_y - iff(y < 34, 30.34, 37.66)) <= 2.2\n'
                         '| order by t asc | project minute, near_post, end_x, end_y')
                    out = [self._insight("set_piece_routine", team["team_id"], "near_post", det, raw, "Near-post corner deliveries", "share", q,
                                         f"{team['name']} running a near-post corner routine",
                                         f"{team['name']} have aimed {len(run)} corners in a row at the near post since {self._display_minute(start)}', "
                                         f"after {round(share_before * 100)}% before: a rehearsed routine. Mark the near-post zone.", [c["id"] for c in run])]
                    return out
        return []

    def _chaos(self, ev: list[dict], n: int) -> list[dict]:
        flips = [0.0] * n
        last_team = None
        ids = []
        for e in ev:
            if e["type"] in ("pass", "carry", "dribble", "shot", "kick_off", "throw_in", "goal_kick", "free_kick", "corner"):
                if last_team is not None and e["team_id"] != last_team:
                    i = minute_index(e["t"], self.p2)
                    if i < n:
                        flips[i] += 1
                        ids.append((i, e["id"]))
                last_team = e["team_id"]
        sm = smooth(flips, 5)
        found = []
        L = 15
        while L < n:
            base = sorted(sm[max(0, L - 30):max(1, L - 6)])
            if not base or (self.halftime[0] <= L - 5 <= self.halftime[1]):
                L += 1
                continue
            median = base[len(base) // 2]
            if sm[L] >= max(median * 1.8, median + 2.0) and L >= 20:
                start = max(0, L - 4)
                det = (L, start, round(median, 2), round(sm[L], 2), 5.0)
                q = (f'match_events | where match_id == "{self.meta["match_id"]}"\n'
                     '| order by t asc | extend flip = team_id != prev(team_id)\n'
                     '| make-series flips = countif(flip) default = 0 on minute from 0 to 100 step 1\n'
                     '| extend smooth = series_fir(flips, repeat(1, 5), true)')
                found.append(self._insight("chaos_spell", "both", "up", det, flips, "Possession changes per minute", "per min", q,
                                           "Chaos: possession flipping",
                                           f"The game has broken up: possession is changing hands {sm[L]:.1f} times a minute, against a typical "
                                           f"{median:.1f}. Neither side can keep the ball.", [i for m, i in ids if m >= start][:12]))
                L += 14
                continue
            L += 1
        return found

    def _shape(self, ev: list[dict], side: str, t: float) -> list[dict]:
        team = self._team(side)
        tid = team["team_id"]
        out, last = [], None
        for m in range(20, int(t // 60) - 9, 3):
            mt = self._minute_t(m - 1)
            before = formation_in_window(ev, team, max(0, mt - 15 * 60), mt, at=mt - 1)
            after = formation_in_window(ev, team, mt + 30, min(t, mt + 12 * 60), at=mt + 60)
            if "unknown" in (before[0], after[0]) or before[0] == after[0] or min(before[1], after[1]) < 0.6:
                continue
            b, a = line_sizes(before[0]), line_sizes(after[0])
            if b[0] == a[0]:
                continue
            if last and m - last < 15:
                continue
            last = m
            direction = "back_five" if a[0] == 5 else "back_three" if a[0] == 3 else "back_four"
            det_idx = min(m - 1 + 10, int(t // 60))
            det = (det_idx, m - 1, float(b[0]), float(a[0]), 5.0)
            raw = [0.0] * (det_idx + 1)
            q = (f'match_events | where match_id == "{self.meta["match_id"]}" and team_id == "{tid}"\n'
                 '| summarize avg_x = avg(x), avg_y = avg(y), touches = count() by player_id, window = bin(t, 900s)\n'
                 '| // shape template matching runs in the Regista API (Hungarian assignment to formation templates)')
            out.append(self._insight("shape_change", tid, direction, det, raw, "Players in the back line", "players", q,
                                     f"{team['name']} switch to {after[0]}",
                                     f"{team['name']} have changed shape from {before[0]} to {after[0]} around {m}': average positions show "
                                     f"{a[0]} players in the back line, up from {b[0]}." if a[0] > b[0] else
                                     f"{team['name']} have changed shape from {before[0]} to {after[0]} around {m}': {a[0]} in the back line, down from {b[0]}.",
                                     []))
        return out
