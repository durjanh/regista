"""Dugout: live decision support for the manager.

For the manager's team at match time t it combines:
- live form: each player's rating so far against his own baseline (scouting corpus, excluding this match);
- fatigue: running rate in his latest 15 minutes vs his first (physical model, altitude-aware);
- risk: bookings for players in duel-heavy roles;
and turns it into ranked recommendations: substitutions with a predicted win-probability impact, tactical
adjustments from the opponent's patterns (channels, pressing, danger men, momentum) and warnings.
Every recommendation carries its evidence. Nothing is applied automatically: the manager decides.
"""

from __future__ import annotations

from ..forge import physical
from ..forge.reference import reference
from ..forge.teams import POSITION_FAMILY
from .engine import MatchAnalyzer, elapsed_regulation, minute_of
from .geometry import channel
from .stats import player_stats, team_stats
from .winprob import live_rates, outcome_probs

ATTACKING = {"FWD", "WIDE", "AM"}
DEFENSIVE = {"DEF", "WB", "MID"}
OPPOSITE = {"left": "right", "right": "left", "center": "center"}


def _ev(fid: str, label: str, value, event_ids: list[str] | None = None) -> dict:
    d = {"fact_id": fid, "label": label, "value": value}
    if event_ids:
        d["event_ids"] = event_ids
    return d


def _wp_with(an: MatchAnalyzer, t: float, attack_mult: float, concede_mult: float, side: str) -> dict:
    sh, sa, xh, xa, rh, ra = an.state_at(t)
    lh, la = live_rates(an.prior[0], an.prior[1], elapsed_regulation(t, an.meta), xh, xa, rh, ra)
    if side == "home":
        lh, la = lh * attack_mult, la * concede_mult
    else:
        la, lh = la * attack_mult, lh * concede_mult
    return {k: round(v, 4) for k, v in outcome_probs(lh, la, sh, sa).items()}


def dugout(an: MatchAnalyzer, doc: dict, side: str, t: float | None, scouting) -> dict:
    meta = an.meta
    t = an.end_t if t is None else min(t, an.end_t)
    ev = an.events_upto(t)
    team, opp_side = meta[side], ("away" if side == "home" else "home")
    opp = meta[opp_side]
    minute = minute_of(t, meta)
    score = ev[-1]["score"] if ev else {"home": 0, "away": 0}
    diff = score[side] - score[opp_side]
    wp_now = an.wp_at(t)
    phys = physical.upto(doc.get("physical") or physical.compute(doc), meta, t, an.end_t)
    stats = {r["player_id"]: r for r in player_stats(ev, meta, t)}
    roster = {p["player_id"]: p for p in team["players"]}
    on_pitch, appeared, booked, subs_used = set(), set(), set(), 0
    for p in team["players"]:
        if p["starter"]:
            on_pitch.add(p["player_id"])
            appeared.add(p["player_id"])
    for e in ev:
        if e["team_id"] != team["team_id"]:
            continue
        if e["type"] == "substitution":
            on_pitch.discard(e["sub_out"])
            on_pitch.add(e["sub_in"])
            appeared.add(e["sub_in"])
            subs_used += 1
        if e.get("card") == "yellow":
            booked.add(e.get("player_id"))
        if e.get("card") in ("red", "second_yellow"):
            on_pitch.discard(e.get("player_id"))

    # fatigue is judged against team-mates: everyone fades late, the manager needs the outliers
    drops = sorted(phys.get(pid, {}).get("drop_pct", 0.0) for pid in on_pitch if roster[pid]["position"] != "GK")
    median_drop = drops[len(drops) // 2] if drops else 0.0
    players = []
    for pid in appeared:
        p = roster[pid]
        st = stats.get(pid, {"rating": 6.0, "minutes": 0})
        ph = phys.get(pid, {"distance_km": 0.0, "first15_km": 0.0, "last15_km": 0.0, "drop_pct": 0.0, "sprints": 0})
        base = scouting.baseline_rating(p.get("player_key") or pid, exclude_match=meta["match_id"]) if scouting else None
        delta = round(st["rating"] - base, 2) if base is not None else None
        drop = ph.get("drop_pct", 0.0)
        level = ("exhausted" if drop >= max(18.0, median_drop + 6) else
                 "tiring" if drop >= max(10.0, median_drop + 3) else "fresh")
        reasons, status = [], "ok"
        on = pid in on_pitch
        if on and p["position"] != "GK":
            if level == "exhausted":
                reasons.append(f"Running rate down {drop:.0f}% on his first 15 minutes (team median {median_drop:.0f}%)")
            elif level == "tiring":
                reasons.append(f"Running rate down {drop:.0f}% (team median {median_drop:.0f}%)")
            if delta is not None and st["minutes"] >= 25 and delta <= -0.8:
                reasons.append(f"Rating {st['rating']} vs his usual {base} ({delta:+.1f})")
            elif st["minutes"] >= 30 and st["rating"] <= 5.7:
                reasons.append(f"Rating {st['rating']} after {st['minutes']} minutes")
            if pid in booked:
                reasons.append("Booked: one more foul risks a red card")
            if delta is not None and -0.8 < delta <= -0.4 and st["minutes"] >= 20:
                reasons.append(f"Below his usual level ({st['rating']} vs {base})")
            poor_form = (delta is not None and st["minutes"] >= 25 and delta <= -0.8) or (st["minutes"] >= 30 and st["rating"] <= 5.7)
            decisive = (delta is not None and delta >= 0.3) or st["rating"] >= 7.6
            if poor_form or (level == "exhausted" and not decisive):
                status = "struggling"
            elif level != "fresh" or pid in booked or (delta is not None and delta <= -0.4):
                status = "watch"
                if level == "exhausted" and decisive:
                    reasons.append("Fading, but still decisive: keep him on unless the game is safe")
            elif (delta is not None and delta >= 0.6) or st["rating"] >= 7.4:
                status = "good"
                reasons.append(f"Rating {st['rating']}" + (f", {delta:+.1f} on his usual" if delta is not None else ""))
        players.append({
            "player_id": pid, "player_key": p.get("player_key"), "name": p["name"], "position": p["position"], "shirt": p["shirt"],
            "on_pitch": on, "minutes": st["minutes"], "rating": st["rating"], "baseline": base, "form_delta": delta,
            "fatigue": {"distance_km": ph["distance_km"], "first15_km": ph.get("first15_km", 0.0), "last15_km": ph.get("last15_km", 0.0),
                        "drop_pct": drop, "sprints": ph["sprints"], "level": level},
            "booked": pid in booked, "status": status, "reasons": reasons,
        })
    order = {"struggling": 0, "watch": 1, "ok": 2, "good": 3}
    players.sort(key=lambda r: (not r["on_pitch"], order[r["status"]], r["shirt"]))

    bench = []
    for p in team["players"]:
        if p["player_id"] in appeared or p["position"] == "GK":
            continue
        base = scouting.baseline_rating(p.get("player_key") or p["player_id"], exclude_match=meta["match_id"]) if scouting else None
        fam = POSITION_FAMILY[p["position"]]
        fit = ("Fresh legs to chase the game" if diff < 0 and fam in ATTACKING else
               "Extra protection to see it out" if diff > 0 and fam in DEFENSIVE else "Like-for-like option")
        bench.append({"player_id": p["player_id"], "player_key": p.get("player_key"), "name": p["name"], "position": p["position"],
                      "baseline": base, "fit": fit})

    recs: list[dict] = []
    # ---- substitutions
    can_sub = subs_used < 5 and minute >= 46 and bench
    struggling = [r for r in players if r["on_pitch"] and r["status"] == "struggling" and r["position"] != "GK"]
    struggling.sort(key=lambda r: (r["fatigue"]["drop_pct"] + (-(r["form_delta"] or 0) * 10)), reverse=True)
    used_bench: set[str] = set()
    for r in struggling[:2] if can_sub else []:
        fam = POSITION_FAMILY[r["position"]]
        if diff < 0 and minute >= 60:
            want = ATTACKING
        elif diff > 0 and minute >= 70:
            want = DEFENSIVE
        else:
            want = None

        def pref(b: dict, fam: str = fam, want: set | None = want) -> tuple:
            bf = POSITION_FAMILY[b["position"]]
            if want is not None:
                return (bf in want, bf == fam)
            return (bf == fam, bf in (ATTACKING if fam in ATTACKING else DEFENSIVE))
        named = lambda b: roster[b["player_id"]].get("name_source") == "dataset"   # noqa: E731
        cands = sorted([b for b in bench if b["player_id"] not in used_bench],
                       key=lambda b: (pref(b), (b["baseline"] or 6.3) + (0.4 if named(b) else 0.0)), reverse=True)
        if not cands:
            break
        on = cands[0]
        used_bench.add(on["player_id"])
        on_fam = POSITION_FAMILY[on["position"]]
        quality = (on["baseline"] or 6.4) - r["rating"]
        freshness = 0.06 if r["fatigue"]["level"] == "exhausted" else 0.03 if r["fatigue"]["level"] == "tiring" else 0.0
        att_mult = 1 + (0.045 * quality + freshness) * (1.0 if on_fam in ATTACKING or fam in ATTACKING else 0.4)
        con_mult = 1 - (0.035 * quality + freshness) * (1.0 if on_fam in DEFENSIVE or fam in DEFENSIVE else 0.3)
        if diff < 0 and on_fam in ATTACKING and fam not in ATTACKING:
            att_mult *= 1.08
            con_mult *= 1.05
        if diff > 0 and on_fam in DEFENSIVE and fam in ATTACKING:
            att_mult *= 0.92
            con_mult *= 0.9
        wp_after = _wp_with(an, t, max(0.7, att_mult), max(0.7, con_mult), side)
        gain = wp_after[side] - wp_now[side] + 0.5 * (wp_after["draw"] - wp_now["draw"]) * (1 if diff < 0 else -1)
        weaker = (on["baseline"] or 6.3) < r["rating"] - 0.3
        if r["fatigue"]["level"] != "exhausted" and (weaker or gain < 0.004):
            used_bench.discard(on["player_id"])
            continue                     # no change that doesn't make us better
        sh, sa, xh, xa, rh, ra = an.state_at(t)
        lh, la = live_rates(an.prior[0], an.prior[1], elapsed_regulation(t, meta), xh, xa, rh, ra)
        our_rem = lh if side == "home" else la
        xg_delta = round(our_rem * (att_mult - 1), 2)
        mid = f"rec-sub-{r['player_id']}-{on['player_id']}"
        recs.append({
            "id": mid, "type": "substitution", "priority": 90 if r["fatigue"]["level"] == "exhausted" else 80,
            "title": f"Replace {r['name']} with {on['name']}",
            "detail": f"{r['name']} is struggling ({'; '.join(r['reasons']).lower()}). {on['name']} ({on['position']}) brings "
                      f"{'a stronger rating record' if quality > 0.3 else 'fresh legs'}" + (f", usually {on['baseline']}" if on["baseline"] else "") + f". {on['fit']}.",
            "evidence": [_ev(f"{mid}:rating", f"{r['name']} rating now", r["rating"]),
                         _ev(f"{mid}:drop", f"{r['name']} running-rate drop", f"{r['fatigue']['drop_pct']}%"),
                         _ev(f"{mid}:base", f"{on['name']} usual rating", on["baseline"] if on["baseline"] is not None else "n/a")],
            "substitution": {"off": {"player_id": r["player_id"], "name": r["name"]}, "on": {"player_id": on["player_id"], "name": on["name"]},
                             "impact": {"wp_before": wp_now, "wp_after": wp_after, "xg_delta": xg_delta}},
        })

    # ---- game-state changes: chase the game or protect the lead even if nobody is struggling
    if can_sub and not [r for r in recs if r["type"] == "substitution"]:
        mode = "chase" if diff < 0 and minute >= 58 else "protect" if diff > 0 and minute >= 72 else None
        if mode:
            want_in = ATTACKING if mode == "chase" else DEFENSIVE
            want_off = DEFENSIVE if mode == "chase" else ATTACKING
            offs = [r for r in players if r["on_pitch"] and r["position"] != "GK" and POSITION_FAMILY[r["position"]] in want_off]
            offs.sort(key=lambda r: (r["rating"] - (r["fatigue"]["drop_pct"] / 20)))
            ons = sorted([b for b in bench if POSITION_FAMILY[b["position"]] in want_in],
                         key=lambda b: (roster[b["player_id"]].get("name_source") == "dataset", b["baseline"] or 6.3), reverse=True)
            if offs and ons:
                r, on = offs[0], ons[0]
                att_mult, con_mult = (1.14, 1.06) if mode == "chase" else (0.93, 0.88)
                wp_after = _wp_with(an, t, att_mult, con_mult, side)
                sh, sa, xh, xa, rh, ra = an.state_at(t)
                lh, la = live_rates(an.prior[0], an.prior[1], elapsed_regulation(t, meta), xh, xa, rh, ra)
                our_rem = lh if side == "home" else la
                mid = f"rec-{mode}-{r['player_id']}-{on['player_id']}"
                recs.append({
                    "id": mid, "type": "substitution", "priority": 78,
                    "title": f"{'Chase the game' if mode == 'chase' else 'Protect the lead'}: {on['name']} for {r['name']}",
                    "detail": (f"We're {abs(diff)} down with {max(0, 95 - minute)} minutes left. Swap a {r['position']} for {on['name']} ({on['position']}) "
                               "to add a body in the box and push the full-backs on." if mode == "chase" else
                               f"We're {diff} up with {max(0, 95 - minute)} minutes left. {on['name']} ({on['position']}) for {r['name']} adds protection "
                               "in front of the back line; drop into a compact block."),
                    "evidence": [_ev(f"{mid}:score", "Score", f"{score['home']}-{score['away']}"), _ev(f"{mid}:minute", "Minute", minute),
                                 _ev(f"{mid}:rating", f"{r['name']} rating now", r["rating"])],
                    "substitution": {"off": {"player_id": r["player_id"], "name": r["name"]}, "on": {"player_id": on["player_id"], "name": on["name"]},
                                     "impact": {"wp_before": wp_now, "wp_after": wp_after, "xg_delta": round(our_rem * (att_mult - 1), 2)}},
                })

    # ---- opponent patterns (last 20 minutes)
    t0 = max(0.0, t - 20 * 60)
    recent = [e for e in ev if e["t"] >= t0]
    chans = {"left": 0, "center": 0, "right": 0}
    for e in recent:
        if e["team_id"] == opp["team_id"] and e["type"] in ("pass", "carry") and e.get("outcome") == "success" and e["x"] < 70 <= e.get("end_x", 0):
            chans[channel(e["end_y"])] += 1
    tot = sum(chans.values()) or 1
    ch_share = {k: round(v / tot, 2) for k, v in chans.items()}
    opp_stats = team_stats(recent, opp["team_id"], team["team_id"])
    our_stats = team_stats(recent, team["team_id"], opp["team_id"])
    dom = max(("left", "right"), key=lambda k: ch_share[k])
    note = f"Most of their attacks come down their {dom} ({round(ch_share[dom] * 100)}% of entries in the last 20 minutes)." if ch_share[dom] >= 0.45 else "Their attacks are spread across the pitch."
    if ch_share[dom] >= 0.45 and tot >= 6:
        our_flank = OPPOSITE[dom]
        fb = next((r for r in players if r["on_pitch"] and r["position"] in (("RB", "RWB") if our_flank == "right" else ("LB", "LWB"))), None)
        recs.append({"id": f"rec-flank-{dom}", "type": "tactical", "priority": 72,
                     "title": f"Shore up our {our_flank} side",
                     "detail": f"{round(ch_share[dom] * 100)}% of their final-third entries in the last 20 minutes came down that flank. "
                               f"Tuck the {our_flank} winger in to double up" + (f" on {fb['name']}'s side" if fb else "") + " and have the nearest midfielder cover the half-space.",
                     "evidence": [_ev(f"rec-flank:{dom}", f"Their entries via their {dom}", f"{round(ch_share[dom] * 100)}%")]})

    # ---- danger men
    opp_rows = [r for r in player_stats(recent, meta, t) if r["team_id"] == opp["team_id"] and r["minutes"] > 0]
    opp_rows.sort(key=lambda r: -(r["xt"] + r["xg"] * 1.5 + r["key_passes"] * 0.05))
    danger = [{"player_id": r["player_id"], "name": r["name"], "xt": round(r["xt"], 2), "xg": round(r["xg"], 2),
               "why": f"{round(r['xt'], 2)} xT, {round(r['xg'], 2)} xG and {r['key_passes']} key passes in the last 20 minutes"} for r in opp_rows[:3]
              if (r["xt"] + r["xg"]) > 0.15]
    if danger:
        d = danger[0]
        recs.append({"id": f"rec-danger-{d['player_id']}", "type": "tactical", "priority": 68, "title": f"Track {d['name']}",
                     "detail": f"He is driving their threat: {d['why']}. Assign a man to deny him the half-space and press his first touch.",
                     "evidence": [_ev(f"rec-danger:{d['player_id']}", f"{d['name']} threat (last 20 min)", f"{d['xt']} xT, {d['xg']} xG")]})

    # ---- pressing / game management
    their_build = sum(1 for e in recent if e["team_id"] == opp["team_id"] and e["type"] == "pass" and e["x"] < 63)
    our_build = sum(1 for e in recent if e["team_id"] == team["team_id"] and e["type"] == "pass" and e["x"] < 63)
    if diff < 0 and minute >= 55 and their_build >= 40 and our_stats["ppda"] and our_stats["ppda"] > 12:
        recs.append({"id": "rec-press", "type": "tactical", "priority": 70, "title": "Press higher",
                     "detail": f"We're behind but allowing {our_stats['ppda']} passes per defensive action in their half. Push the line up and press their build-up.",
                     "evidence": [_ev("rec-press:ppda", "Our PPDA (last 20 min)", our_stats["ppda"])]})
    full_opp_ppda = team_stats(ev, opp["team_id"], team["team_id"])["ppda"]
    if our_build >= 40 and opp_stats["ppda"] and full_opp_ppda and opp_stats["ppda"] < 0.7 * full_opp_ppda:
        recs.append({"id": "rec-bypass", "type": "tactical", "priority": 60, "title": "Bypass their press",
                     "detail": f"They've stepped up their press (PPDA {opp_stats['ppda']} in the last 20 minutes vs {full_opp_ppda} overall). Use the keeper, go longer into the striker and play off second balls.",
                     "evidence": [_ev("rec-bypass:ppda", "Their PPDA (last 20 min)", opp_stats["ppda"])]})
    mom = an.momentum_series(ev)[-8:]
    against = sum(1 for m in mom if (m["value"] <= -0.45 if side == "home" else m["value"] >= 0.45))
    if against >= 6:
        recs.append({"id": "rec-momentum", "type": "warning", "priority": 74, "title": "Ride out their spell",
                     "detail": f"They've controlled territory and threat for {against} of the last 8 minutes. Slow it down: keep the ball, use a stoppage to reset the shape.",
                     "evidence": [_ev("rec-momentum:min", "Minutes of their dominance (last 8)", against)]})
    venue = dict(meta.get("venue_info") or {"city": meta.get("venue", "")})
    acclimatised = team["team_id"] in (venue.get("acclimatised") or [])
    if venue.get("altitude_m", 0) >= 1500 and not acclimatised and minute >= 50:
        tired = sum(1 for r in players if r["on_pitch"] and r["fatigue"]["level"] != "fresh")
        recs.append({"id": "rec-altitude", "type": "warning", "priority": 66, "title": f"Altitude: {venue['altitude_m']:,} m",
                     "detail": f"{tired} of our players are already fading. Plan the substitutions earlier than usual and keep the ball to save legs.",
                     "evidence": [_ev("rec-altitude:m", "Venue altitude", f"{venue['altitude_m']} m")]})
    for r in players:
        if r["on_pitch"] and r["booked"] and r["position"] in ("CB", "RB", "LB", "DM", "RWB", "LWB"):
            recs.append({"id": f"rec-card-{r['player_id']}", "type": "warning", "priority": 58, "title": f"{r['name']} is on a yellow",
                         "detail": "He plays in a duel-heavy role: tell him to stay on his feet, or consider replacing him if the opponent targets his side.",
                         "evidence": [_ev(f"rec-card:{r['player_id']}", "Booked", "yes")]})
    recs.sort(key=lambda r: -r["priority"])

    rec_country = None
    real = (meta.get("source") or {}).get("real")
    if real:
        ref = reference()
        rows = [x for x in ref.results if x["country"] == real["country"] and team["name"] in (x["home_team"], x["away_team"]) and x["date"] < real["date"]]
        if rows:
            w = sum(1 for x in rows if (x["home_team"] == team["name"] and x["home_score"] > x["away_score"]) or (x["away_team"] == team["name"] and x["away_score"] > x["home_score"]))
            lo = sum(1 for x in rows if (x["home_team"] == team["name"] and x["home_score"] < x["away_score"]) or (x["away_team"] == team["name"] and x["away_score"] < x["home_score"]))
            gf = sum(x["home_score"] if x["home_team"] == team["name"] else x["away_score"] for x in rows)
            ga = sum(x["away_score"] if x["home_team"] == team["name"] else x["home_score"] for x in rows)
            rec_country = {"country": real["country"], "played": len(rows), "won": w, "drawn": len(rows) - w - lo, "lost": lo,
                           "gf": gf, "ga": ga, "win_pct": round(w / len(rows), 3)}
    venue_out = {"city": venue.get("city", ""), **({"altitude_m": venue["altitude_m"]} if venue.get("altitude_m") else {}),
                 **({"note": venue["note"]} if venue.get("note") else {}), **({"record_in_country": rec_country} if rec_country else {})}
    return {
        "match_id": meta["match_id"], "side": side, "team_id": team["team_id"], "opponent_id": opp["team_id"], "minute": minute, "t": t,
        "score": score, "win_prob": wp_now, "venue": venue_out, "players": players, "bench": bench, "subs_used": subs_used,
        "recommendations": recs[:8], "danger_men": danger,
        "opponent_patterns": {"channels": ch_share, "ppda": opp_stats["ppda"], "field_tilt": opp_stats["field_tilt"], "note": note},
    }
