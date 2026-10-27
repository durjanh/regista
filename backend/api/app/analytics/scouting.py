"""Scouting: Player DNA, goalkeeper and team reports, built from REAL records and MODEL event data.

REAL: the results dataset (international goals, penalty goals, assists, goal minutes, venues, opponents' Elo,
home/away/neutral records). MODEL: tendencies rediscovered from Regista's synthetic events across a scouting corpus
(the featured real-result rebuilds plus simulated matches for every featured team). The engine knows each player's
true tendency profile, so the evals can measure how well scouting recovers it.
"""

from __future__ import annotations

import random
import threading
from collections import Counter, defaultdict

from ..forge import physical
from ..forge.reference import reference, slug
from ..forge.teams import POSITION_FAMILY
from ..forge.traits import sample, traits_for
from .geometry import channel, in_box
from .stats import _is_progressive, player_stats

MIN_MINUTES = 150
SIDE_VIEW = {"left": "his left", "right": "his right", "center": "down the middle"}
KEEPER_SIDE = {"left": "right", "right": "left", "center": "centre"}   # taker's left is the keeper's right

PER90_METRICS = [
    ("goals", "Goals", True), ("xg", "Expected goals (xG)", True), ("shots", "Shots", True), ("xt", "Threat added (xT)", True),
    ("key_passes", "Key passes", True), ("passes", "Passes", True), ("pass_completion", "Pass completion", True),
    ("progressive_passes", "Progressive passes", True), ("tackles", "Tackles", True), ("interceptions", "Interceptions", True),
    ("pressures", "Pressures", True), ("dribbles", "Successful dribbles", True), ("distance_km", "Distance (km)", True),
    ("sprints", "Sprints", True),
]

# How each position family is named in strengths and weaknesses ("top 9% of goalkeepers").
PEER_LABEL = {"GK": "goalkeepers", "DEF": "defenders", "WB": "wing-backs", "MID": "midfielders", "AM": "attacking midfielders",
              "WIDE": "wingers", "FWD": "strikers"}


def _new_agg() -> dict:
    return {"matches": 0, "minutes": 0.0, "sum": Counter(), "passes_att": 0, "passes_ok": 0, "shots": [], "pens": [],
            "ratings": [], "gk": Counter(), "dives": [], "positions": Counter(), "name": "", "team_id": "", "name_source": "dataset",
            "match_ratings": {}}


class ScoutingIndex:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.ready = False
        self.players: dict[str, dict] = {}
        self.teams: dict[str, dict] = {}
        self._goal_index: dict[str, list[dict]] | None = None

    # ------------------------------------------------------------------ build

    def build(self, docs: list[dict]) -> None:
        players: dict[str, dict] = defaultdict(_new_agg)
        teams: dict[str, dict] = defaultdict(lambda: {"matches": 0, "channels": Counter(), "ppda": [], "tilt": [], "aerial": 0, "shots": 0,
                                                       "names": set()})
        for doc in docs:
            self._add_match(doc, players, teams)
        with self.lock:
            self.players = dict(players)
            self.teams = dict(teams)
            self.ready = True

    def _add_match(self, doc: dict, players: dict, teams: dict) -> None:
        meta, events = doc["meta"], doc["events"]
        end_t = events[-1]["t"] if events else 0
        phys = physical.upto(doc.get("physical") or physical.compute(doc), meta, end_t, end_t)
        stats = {r["player_id"]: r for r in player_stats(events, meta)}
        roster = {p["player_id"]: p for s in ("home", "away") for p in meta[s]["players"]}
        gk_of = {meta[s]["team_id"]: next(p["player_id"] for p in meta[s]["players"] if p["position"] == "GK") for s in ("home", "away")}
        per = defaultdict(Counter)
        for e in events:
            pid = e.get("player_id")
            if not pid:
                continue
            if e["type"] == "pressure":
                per[pid]["pressures"] += 1
            elif e["type"] == "dribble" and e.get("outcome") == "success":
                per[pid]["dribbles"] += 1
            elif e["type"] == "pass" and _is_progressive(e):
                per[pid]["progressive_passes"] += 1
            if e["type"] == "goal_kick":
                per[pid]["gk_long" if e.get("pass_type") == "long" else "gk_short"] += 1
        for pid, st in stats.items():
            p = roster.get(pid)
            if not p or st["minutes"] <= 0:
                continue
            key = p.get("player_key") or pid
            a = players[key]
            a["name"], a["team_id"], a["name_source"] = p["name"], p["team_id"], p.get("name_source", "dataset")
            a["positions"][p["position"]] += st["minutes"]
            a["matches"] += 1
            a["minutes"] += st["minutes"]
            a["ratings"].append(st["rating"])
            a["match_ratings"][meta["match_id"]] = st["rating"]
            for k in ("goals", "xg", "shots", "xt", "key_passes", "tackles", "interceptions", "assists"):
                a["sum"][k] += st[k]
            a["passes_att"] += st["passes"]
            a["passes_ok"] += round(st["passes"] * st["pass_completion"])
            for k in ("pressures", "dribbles", "progressive_passes"):
                a["sum"][k] += per[pid][k]
            ph = phys.get(pid)
            if ph:
                a["sum"]["distance_km"] += ph["distance_km"]
                a["sum"]["sprints"] += ph["sprints"]
            if p["position"] == "GK":
                a["gk"]["long"] += per[pid]["gk_long"]
                a["gk"]["short"] += per[pid]["gk_short"]
        for e in events:
            if e["type"] != "shot":
                continue
            pid = e.get("player_id")
            p = roster.get(pid)
            if p and "own_goal" not in (e.get("tags") or []):
                key = p.get("player_key") or pid
                rec = {"x": e["x"], "y": e["y"], "xg": e.get("xg", 0), "outcome": e.get("shot_outcome"), "body": e.get("body_part"),
                       "channel": channel(e["y"]), "box": in_box(e["x"], e["y"]), "situation": e.get("situation")}
                if e.get("situation") == "penalty":
                    players[key]["pens"].append({"placement": e.get("placement"), "outcome": e.get("shot_outcome")})
                else:
                    players[key]["shots"].append(rec)
            # goalkeeper on the other side
            opp_team = meta["away"]["team_id"] if e["team_id"] == meta["home"]["team_id"] else meta["home"]["team_id"]
            gk = roster.get(gk_of[opp_team])
            if gk:
                g = players[gk.get("player_key") or gk["player_id"]]["gk"]
                if e.get("situation") == "penalty":
                    g["pens_faced"] += 1
                    g["pens_saved"] += e.get("shot_outcome") == "saved"
                    players[gk.get("player_key") or gk["player_id"]]["dives"].append(e.get("gk_dive"))
                else:
                    g["xg_faced"] += e.get("xg", 0)
                    if e.get("shot_outcome") in ("saved", "goal"):
                        g["on_target"] += 1
                        g["saves"] += e.get("shot_outcome") == "saved"
                    if e.get("shot_outcome") == "goal" and "own_goal" not in (e.get("tags") or []):
                        g["conceded"] += 1
        a_home, a_away = doc["meta"]["home"]["team_id"], doc["meta"]["away"]["team_id"]
        for tid, oid in ((a_home, a_away), (a_away, a_home)):
            t = teams[tid]
            t["matches"] += 1
            for e in events:
                if e["team_id"] == tid and e["type"] in ("pass", "carry") and e.get("outcome") == "success" and e["x"] < 70 <= e.get("end_x", 0):
                    t["channels"][channel(e["end_y"])] += 1
                if e["team_id"] == tid and e["type"] == "shot":
                    t["shots"] += 1
                    t["aerial"] += e.get("body_part") == "head"
            from .stats import team_stats
            ts = team_stats(events, tid, oid)
            t["ppda"].append(ts["ppda"])
            t["tilt"].append(ts["field_tilt"])

    # ------------------------------------------------------------------ helpers

    def goal_index(self) -> dict[str, list[dict]]:
        if self._goal_index is None:
            idx: dict[str, list[dict]] = defaultdict(list)
            for g in reference().goal_rows:
                idx[g["scorer"]].append(g)
            self._goal_index = dict(idx)
        return self._goal_index

    def per90(self, a: dict) -> dict:
        m = max(a["minutes"], 1.0)
        out = {k: round(a["sum"][k] * 90 / m, 2) for k in ("goals", "xg", "shots", "xt", "key_passes", "tackles", "interceptions",
                                                             "pressures", "dribbles", "progressive_passes", "distance_km", "sprints")}
        out["passes"] = round(a["passes_att"] * 90 / m, 1)
        out["pass_completion"] = round(a["passes_ok"] / a["passes_att"], 3) if a["passes_att"] else 0.0
        return out

    @staticmethod
    def position(a: dict) -> str:
        return a["positions"].most_common(1)[0][0] if a["positions"] else "CM"

    def baseline_rating(self, key: str, exclude_match: str | None = None) -> float | None:
        a = self.players.get(key)
        if not a:
            return None
        vals = [r for mid, r in a["match_ratings"].items() if mid != exclude_match]
        return round(sum(vals) / len(vals), 2) if vals else None

    def percentiles(self, key: str) -> list[dict]:
        a = self.players[key]
        fam = POSITION_FAMILY.get(self.position(a), "MID")
        peers = [k for k, b in self.players.items() if b["minutes"] >= MIN_MINUTES and POSITION_FAMILY.get(self.position(b), "MID") == fam]
        if key not in peers:
            peers.append(key)
        p90 = {k: self.per90(self.players[k]) for k in peers}
        mine = p90[key]
        out = []
        for metric, label, higher in PER90_METRICS:
            vals = sorted(v[metric] for v in p90.values())
            below = sum(1 for v in vals if v < mine[metric])
            ties = sum(1 for v in vals if v == mine[metric]) - 1
            # Mid-rank: tied peers share the middle rank, so a metric every peer has at 0 (goals for goalkeepers) sits at
            # the 50th percentile instead of reading as "bottom 1%".
            pct = round(100 * (below + ties / 2) / max(1, len(vals) - 1)) if len(vals) > 1 else 50
            out.append({"metric": metric, "label": label, "value": mine[metric], "percentile": pct if higher else 100 - pct,
                        "peers": len(vals), "higher_is_better": higher})
        return out

    # ------------------------------------------------------------------ real record

    def real_record(self, name: str, team_name: str) -> dict | None:
        ref = reference()
        goals = [g for g in self.goal_index().get(name, []) if g["team"] == team_name and not g["own_goal"]]
        assists = sum(1 for g in ref.goal_rows if g["assist"] == name and g["team"] == team_name)
        if not goals and not assists:
            return None
        bins = Counter()
        venue = Counter()
        strong = 0
        results = {(r["date"], r["home_team"], r["away_team"]): r for r in ref.results} if not hasattr(self, "_results_idx") else self._results_idx
        self._results_idx = results
        recent = []
        for g in sorted(goals, key=lambda g: g["date"]):
            m = g["minute"] or 45
            bins[min((m - 1) // 15, 5)] += 1
            r = results.get((g["date"], g["home_team"], g["away_team"]))
            if r:
                v = "neutral" if r["neutral"] else ("home" if r["home_team"] == team_name else "away")
                venue[v] += 1
                opp = r["away_team"] if r["home_team"] == team_name else r["home_team"]
                eh, ea = ref.pre_elo.get((r["date"], r["home_team"], r["away_team"]), (1500, 1500))
                opp_elo = ea if r["home_team"] == team_name else eh
                strong += opp_elo >= 1850
                recent.append({"date": g["date"], "opponent": opp, "minute": m, "penalty": g["penalty"], "tournament": r["tournament"]})
        labels = ["1-15", "16-30", "31-45", "46-60", "61-75", "76-90+"]
        return {
            "international_goals": len(goals), "penalty_goals": sum(1 for g in goals if g["penalty"]), "assists_recorded": assists,
            "first_goal": goals[0]["date"] if goals else "", "last_goal": goals[-1]["date"] if goals else "",
            "goals_by_period": [{"bin": labels[i], "goals": bins[i]} for i in range(6)],
            "venue_split": {k: venue[k] for k in ("home", "away", "neutral")}, "vs_top30_elo": strong,
            "recent_goals": recent[-8:][::-1],
            "source": "International results 1872-2026 (CC0, martj42/international_results); goals from competitive internationals, not friendlies",
        }

    # ------------------------------------------------------------------ player DNA

    def player_dna(self, key: str) -> dict:
        if key not in self.players:
            raise KeyError(key)
        a = self.players[key]
        ref = reference()
        team_name = ref.names.get(a["team_id"], a["team_id"])
        pos = self.position(a)
        tr = traits_for(key, pos)
        real = self.real_record(a["name"], team_name) if a["name_source"] == "dataset" else None
        shots = a["shots"]
        n = max(1, len(shots))
        foot = Counter(s["body"] for s in shots)
        chans = Counter(s["channel"] for s in shots)
        # penalty archive: real penalty goals with modelled placements (+ modelled misses at a typical ~78% conversion)
        pens = list(a["pens"])
        real_pens = real["penalty_goals"] if real else 0
        if real_pens:
            rng = random.Random(key)
            for _ in range(real_pens):
                pens.append({"placement": sample(tr.penalty, rng), "outcome": "goal"})
            for _ in range(round(real_pens * 0.28)):
                pens.append({"placement": sample(tr.penalty, rng), "outcome": "saved"})
        pen_block = None
        if pens:
            pc = Counter(p["placement"] for p in pens)
            pen_block = {"real_scored": real_pens, "modelled_taken": len(pens),
                         "placement": {k: round(pc[k] / len(pens), 2) for k in ("left", "center", "right")},
                         "conversion": round(sum(1 for p in pens if p["outcome"] == "goal") / len(pens), 2)}
        gk_block = None
        if pos == "GK":
            g = a["gk"]
            dives = [d for d in a["dives"] if d]
            rng = random.Random(key + ":gk")
            dives += [sample(tr.gk_dive, rng) for _ in range(24)]          # modelled penalty archive
            dc = Counter(dives)
            on_t = max(1, g["on_target"])
            gk_block = {"penalties_faced": g["pens_faced"] + 24, "dive": {k: round(dc[k] / len(dives), 2) for k in ("left", "center", "right")},
                        "penalty_save_pct": round((g["pens_saved"] + 5) / (g["pens_faced"] + 24), 2),
                        "shots_faced": g["on_target"], "saves": g["saves"], "save_pct": round(g["saves"] / on_t, 3),
                        "xg_faced": round(g["xg_faced"], 2), "goals_conceded": g["conceded"],
                        "goals_prevented": round(g["xg_faced"] - g["conceded"], 2),
                        "long_distribution_pct": round(g["long"] / max(1, g["long"] + g["short"]), 2)}
        model = {
            "matches": a["matches"], "minutes": round(a["minutes"]), "per90": self.per90(a),
            "foot": {"right": round(foot["right_foot"] / n, 2), "left": round(foot["left_foot"] / n, 2), "head": round(foot["head"] / n, 2)},
            "shot_channels": {k: round(chans[k] / n, 2) for k in ("left", "center", "right")},
            "shot_zones": {"inside_box": round(sum(s["box"] for s in shots) / n, 2), "outside_box": round(1 - sum(s["box"] for s in shots) / n, 2) if shots else 0},
            "shot_map": [{"x": s["x"], "y": s["y"], "xg": s["xg"], "outcome": s["outcome"]} for s in shots[-80:]],
            "goal_map": [{"x": s["x"], "y": s["y"], "xg": s["xg"]} for s in shots if s["outcome"] == "goal"],
            "penalties": pen_block, "goalkeeping": gk_block, "percentiles": self.percentiles(key),
        }
        strengths, weaknesses = self._strengths(model, real, pos)
        return {"player_key": key, "name": a["name"], "team_id": a["team_id"], "team_name": team_name, "position": pos,
                "name_source": a["name_source"], "real": real, "model": model, "strengths": strengths, "weaknesses": weaknesses,
                "how_to_stop": self._how_to_stop(model, real, pos, tr.foot, a["name"]),
                "disclosure": ("REAL figures come from the CC0 international results dataset, whose goalscorers cover competitive internationals (World Cups, qualifiers, continental cups), not friendlies. MODEL figures are rediscovered from "
                               f"Regista's synthetic events across {a['matches']} matches; in production the same analytics run on a licensed event feed.")}

    def _strengths(self, model: dict, real: dict | None, pos: str) -> tuple[list[str], list[str]]:
        s, w = [], []
        peers = PEER_LABEL.get(POSITION_FAMILY.get(pos, "MID"), "")
        for p in model["percentiles"]:
            if p["peers"] < 5:
                continue
            if p["percentile"] >= 80 and p["value"] > 0:
                s.append(f"{p['label']}: top {100 - p['percentile']}% of {peers} ({p['value']} per 90)" if p["metric"] != "pass_completion"
                         else f"Pass completion {round(p['value'] * 100)}%: top {100 - p['percentile']}% of {peers}")
            elif p["percentile"] <= 20:
                w.append(f"{p['label']}: bottom {p['percentile'] + 1}% of {peers} ({p['value']}{'' if p['metric'] == 'pass_completion' else ' per 90'})")
        if real and real["international_goals"] >= 10:
            s.insert(0, f"Proven scorer: {real['international_goals']} competitive international goals (REAL)")
        return s[:6], w[:5]

    def _how_to_stop(self, model: dict, real: dict | None, pos: str, foot: str, name: str) -> list[dict]:
        out = []
        surname = name.split(" ")[-1]
        ch, ft, zones = model["shot_channels"], model["foot"], model["shot_zones"]
        n_shots = len(model["shot_map"])
        if pos == "GK" and model["goalkeeping"]:
            g = model["goalkeeping"]
            fav = max(("left", "right"), key=lambda k: g["dive"][k])
            out.append({"title": "Penalties: send him the wrong way",
                        "detail": f"He dives to the taker's {fav} {round(g['dive'][fav] * 100)}% of the time (MODEL). Takers should aim {('right' if fav == 'left' else 'left')} or go down the middle.",
                        "evidence": f"{g['penalties_faced']} penalties faced (modelled archive)"})
            if g["long_distribution_pct"] >= 0.5:
                out.append({"title": "Press the goal kick's landing zone", "detail": f"He goes long {round(g['long_distribution_pct'] * 100)}% of the time: win the first header and the second ball.",
                            "evidence": "Goal-kick distribution (MODEL)"})
            return out
        if n_shots >= 6:
            side = max(("left", "right"), key=lambda k: ch[k])
            if ch[side] >= 0.38:
                cut_in = (side == "left" and foot == "right") or (side == "right" and foot == "left")
                if cut_in:
                    out.append({"title": f"He cuts in from the {side} onto his {foot} foot",
                                "detail": f"{round(ch[side] * 100)}% of his shots come from the {side} channel. Show him down the line onto his weaker foot; the full-back sits on his inside shoulder and the nearest midfielder blocks the cut-back lane.",
                                "evidence": f"{n_shots} shots (MODEL)"})
                else:
                    out.append({"title": f"Shuts down the {side} channel",
                                "detail": f"{round(ch[side] * 100)}% of his shots come from the {side} side. Overload that flank and keep the centre-back on that side tight to him.",
                                "evidence": f"{n_shots} shots (MODEL)"})
            strong = max(("right", "left"), key=lambda k: ft[k])
            if ft[strong] >= 0.7:
                out.append({"title": f"Heavily {strong}-footed", "detail": f"{round(ft[strong] * 100)}% of his shots are with his {strong} foot. Force him onto his other side.",
                            "evidence": "Shot foot split (MODEL)"})
            if ft["head"] >= 0.22:
                out.append({"title": "Aerial threat", "detail": f"{round(ft['head'] * 100)}% of his attempts are headers. Put your best header on him at set pieces and stop crosses at source.",
                            "evidence": "Header share (MODEL)"})
            if zones["outside_box"] >= 0.45:
                out.append({"title": "Shoots from distance", "detail": "Close him down at the edge of the box; never give him a yard to set himself.",
                            "evidence": f"{round(zones['outside_box'] * 100)}% of shots from outside the box (MODEL)"})
            elif zones["inside_box"] >= 0.75:
                out.append({"title": "Penalty-box predator", "detail": "Lives between the posts: track his near-post runs and keep a body on him for cut-backs.",
                            "evidence": f"{round(zones['inside_box'] * 100)}% of shots inside the box (MODEL)"})
        pen = model["penalties"]
        if pen and pen["modelled_taken"] >= 4:
            fav = max(("left", "center", "right"), key=lambda k: pen["placement"][k])
            out.append({"title": f"Penalties: {surname} goes {SIDE_VIEW[fav]}",
                        "detail": f"{round(pen['placement'][fav] * 100)}% of his penalties go to {SIDE_VIEW[fav]} (MODEL): the keeper should go to his own {KEEPER_SIDE[fav]}."
                                  + (f" He has {pen['real_scored']} international penalty goals (REAL)." if pen["real_scored"] else ""),
                        "evidence": f"{pen['modelled_taken']} penalties (real goals + modelled placements)"})
        p90 = model["per90"]
        pct = {x["metric"]: x["percentile"] for x in model["percentiles"]}
        if pct.get("key_passes", 0) >= 75 and p90["key_passes"] > 0.8:
            out.append({"title": "Creator: deny him the half-space", "detail": "Screen him with a holding midfielder and press his first touch.",
                        "evidence": f"{p90['key_passes']} key passes per 90 (MODEL)"})
        if pct.get("dribbles", 0) >= 75 and p90["dribbles"] > 0.8:
            out.append({"title": "Don't dive in", "detail": "He beats men 1v1: stay on your feet, show him outside and double up.",
                        "evidence": f"{p90['dribbles']} successful dribbles per 90 (MODEL)"})
        if pct.get("pass_completion", 50) <= 25 and p90["passes"] > 20:
            out.append({"title": "Press him in possession", "detail": "Loose under pressure: trigger the press when he receives facing his own goal.",
                        "evidence": f"{round(p90['pass_completion'] * 100)}% pass completion (MODEL)"})
        if real:
            late = sum(b["goals"] for b in real["goals_by_period"] if b["bin"] == "76-90+")
            if real["international_goals"] >= 8 and late / real["international_goals"] >= 0.28:
                out.append({"title": "Dangerous late", "detail": "Keep your concentration and your freshest legs on him in the last quarter.",
                            "evidence": f"{late} of {real['international_goals']} competitive international goals after 75' (REAL)"})
        return out[:6]

    # ------------------------------------------------------------------ team report

    def team_report(self, team_id: str) -> dict:
        ref = reference()
        name = ref.name_of(team_id)
        since = "2018-01-01"
        games = [r for r in ref.results if r["date"] >= since and name in (r["home_team"], r["away_team"])]

        def rec(rows: list[dict]) -> dict:
            w = sum(1 for r in rows if (r["home_team"] == name and r["home_score"] > r["away_score"]) or (r["away_team"] == name and r["away_score"] > r["home_score"]))
            lo = sum(1 for r in rows if (r["home_team"] == name and r["home_score"] < r["away_score"]) or (r["away_team"] == name and r["away_score"] < r["home_score"]))
            gf = sum(r["home_score"] if r["home_team"] == name else r["away_score"] for r in rows)
            ga = sum(r["away_score"] if r["home_team"] == name else r["home_score"] for r in rows)
            return {"played": len(rows), "won": w, "drawn": len(rows) - w - lo, "lost": lo, "gf": gf, "ga": ga,
                    "win_pct": round(w / len(rows), 3) if rows else 0.0}
        home = [r for r in games if not r["neutral"] and r["home_team"] == name]
        away = [r for r in games if not r["neutral"] and r["away_team"] == name]
        neutral = [r for r in games if r["neutral"]]
        last10 = [{"date": r["date"], "opponent": r["away_team"] if r["home_team"] == name else r["home_team"],
                   "gf": r["home_score"] if r["home_team"] == name else r["away_score"], "ga": r["away_score"] if r["home_team"] == name else r["home_score"],
                   "venue": "neutral" if r["neutral"] else ("home" if r["home_team"] == name else "away"), "tournament": r["tournament"]} for r in games[-10:][::-1]]
        recent_goals = [g for g in ref.goal_rows if g["team"] == name and g["date"] >= "2022-01-01" and not g["own_goal"]]
        sc = Counter(g["scorer"] for g in recent_goals)
        pens = Counter(g["scorer"] for g in recent_goals if g["penalty"])
        squad = {k: a for k, a in self.players.items() if a["team_id"] == team_id and a["minutes"] >= 270}

        def leaders(metric: str, unit: str, fn) -> list[dict]:
            rows = sorted(((k, fn(a)) for k, a in squad.items() if a["name_source"] == "dataset" or metric != "rating"), key=lambda r: -r[1])[:5]
            return [{"player_key": k, "name": squad[k]["name"], "value": round(v, 2), "unit": unit} for k, v in rows]
        t = self.teams.get(team_id, {"matches": 0, "channels": Counter(), "ppda": [], "tilt": [], "aerial": 0, "shots": 0})
        ch_tot = sum(t["channels"].values()) or 1
        takers = []
        all_pens = Counter(g["scorer"] for g in ref.goal_rows if g["team"] == name and g["penalty"] and g["date"] >= "2016-01-01")
        for scorer, n in all_pens.most_common(3):
            key = f"{team_id}:{slug(scorer)}"
            tr = traits_for(key, ref.known_position(name, scorer) or "ST")
            fav = max(("left", "center", "right"), key=lambda k: tr.penalty[k])
            dna_pen = None
            if key in self.players:
                try:
                    dna_pen = self.player_dna(key)["model"]["penalties"]
                except Exception:
                    dna_pen = None
            share = dna_pen["placement"][fav] if dna_pen else tr.penalty[fav]
            takers.append({"player_key": key, "name": scorer, "real_scored": n, "favourite_side": fav, "share": round(share, 2)})
        gk_key = f"{team_id}:no-1"
        gk = None
        if gk_key in self.players:
            g = self.player_dna(gk_key)["model"]["goalkeeping"]
            fav = max(("left", "right"), key=lambda k: g["dive"][k])
            gk = {"player_key": gk_key, "name": self.players[gk_key]["name"], "favourite_dive": fav, "share": g["dive"][fav], "save_pct": g["save_pct"]}
        p90 = {k: self.per90(a) for k, a in squad.items()}
        danger = sorted(squad, key=lambda k: -(p90[k]["xt"] + p90[k]["xg"] * 1.5 + 0.02 * sc.get(squad[k]["name"], 0)))[:3]
        report = {
            "team_id": team_id, "name": name, "colors": ref.colors(name), "elo": round(ref.elo_now.get(name, 1500)),
            "rank": next((x["rank"] for x in ref.ranking() if x["team_id"] == team_id), None),
            "real": {"overall": rec(games), "home": rec(home), "away": rec(away), "neutral": rec(neutral), "since": since, "last10": last10,
                     "top_scorers_recent": [{"name": n, "goals": c, "penalties": pens.get(n, 0)} for n, c in sc.most_common(6)]},
            "model": {"matches": t["matches"],
                      "leaders": {"most_distance": leaders("distance", "km/90", lambda a: self.per90(a)["distance_km"]),
                                  "most_passes": leaders("passes", "passes/90", lambda a: self.per90(a)["passes"]),
                                  "top_rated": leaders("rating", "avg rating", lambda a: sum(a["ratings"]) / len(a["ratings"])),
                                  "top_threat": leaders("xt", "xT/90", lambda a: self.per90(a)["xt"]),
                                  "most_pressures": leaders("pressures", "pressures/90", lambda a: self.per90(a)["pressures"]),
                                  "most_sprints": leaders("sprints", "sprints/90", lambda a: self.per90(a)["sprints"])},
                      "attacking_channels": {k: round(t["channels"][k] / ch_tot, 3) for k in ("left", "center", "right")},
                      "penalty_takers": takers, "goalkeeper": gk},
            "danger_men": [{"player_key": k, "name": squad[k]["name"],
                            "why": f"{p90[k]['xt']} xT and {p90[k]['xg']} xG per 90 (MODEL)" + (f"; {sc[squad[k]['name']]} competitive international goals since 2022 (REAL)" if sc.get(squad[k]["name"]) else "")}
                           for k in danger],
            "disclosure": ("REAL records come from the CC0 international results dataset. MODEL figures come from Regista's synthetic events "
                           f"across {t['matches']} matches for this team."),
        }
        report["how_to_play_against"] = self._how_to_play(report, t)
        return report

    def _how_to_play(self, r: dict, t: dict) -> list[dict]:
        out = []
        ch = r["model"]["attacking_channels"]
        side = max(("left", "right"), key=lambda k: ch[k])
        if ch[side] >= 0.38:
            ours = "right" if side == "left" else "left"
            out.append({"title": f"They attack down their {side}", "detail": f"{round(ch[side] * 100)}% of their final-third entries come down their {side}: keep your {ours}-back disciplined and slide a midfielder across.",
                        "evidence": "Final-third entries (MODEL)"})
        if t["ppda"]:
            ppda = sum(t["ppda"]) / len(t["ppda"])
            if ppda and ppda < 9:
                out.append({"title": "Beat the press", "detail": f"They press high (PPDA {ppda:.1f}). Play through or over the first line, and use your keeper as the extra man.",
                            "evidence": "PPDA (MODEL)"})
            elif ppda > 13:
                out.append({"title": "Be patient", "detail": f"They sit off (PPDA {ppda:.1f}). Keep the ball, switch play and draw them out before going vertical.",
                            "evidence": "PPDA (MODEL)"})
        home, away = r["real"]["home"], r["real"]["away"]
        if home["played"] >= 5 and away["played"] >= 5 and home["win_pct"] - away["win_pct"] >= 0.2:
            out.append({"title": "A different side away from home", "detail": f"They win {round(home['win_pct'] * 100)}% at home but {round(away['win_pct'] * 100)}% away since {r['real']['since'][:4]}.",
                        "evidence": "Results since 2018 (REAL)"})
        for d in r["danger_men"][:2]:
            out.append({"title": f"Stop {d['name']}", "detail": "See his Player DNA for the tendencies to target.", "evidence": d["why"]})
        if r["model"]["goalkeeper"]:
            g = r["model"]["goalkeeper"]
            out.append({"title": "Penalties against their keeper", "detail": f"He dives to the taker's {g['favourite_dive']} {round(g['share'] * 100)}% of the time: aim the other way.",
                        "evidence": "Penalty dives (MODEL)"})
        if t["shots"] and t["aerial"] / t["shots"] >= 0.2:
            out.append({"title": "Defend set pieces", "detail": f"{round(t['aerial'] / t['shots'] * 100)}% of their attempts are headers: zonal cover at the near post plus man-marking their best headers.",
                        "evidence": "Header share (MODEL)"})
        return out[:6]

    def search(self, team_id: str | None = None, q: str | None = None) -> list[dict]:
        ref = reference()
        rows = []
        for k, a in self.players.items():
            if team_id and a["team_id"] != team_id:
                continue
            if q and q.lower() not in a["name"].lower():
                continue
            rows.append({"player_key": k, "name": a["name"], "team_id": a["team_id"], "team_name": ref.names.get(a["team_id"], a["team_id"]),
                         "position": self.position(a), "matches": a["matches"], "rating": round(sum(a["ratings"]) / len(a["ratings"]), 2) if a["ratings"] else None,
                         "name_source": a["name_source"]})
        rows.sort(key=lambda r: (r["team_name"], -(r["rating"] or 0)))
        return rows


scouting = ScoutingIndex()
