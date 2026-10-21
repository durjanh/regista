"""Key-moment detection with explanations.

Every moment carries the evidence that triggered it (metrics with values and the event ids behind them) and a
structured explanation (why it matters + contributing factors). Narratives are generated from these facts only.
"""

from __future__ import annotations

from .stats import possession_chain
from .xg import shot_xg


def _clock(e: dict) -> str:
    return f"{e['minute']}+{e['added_minute']}'" if e.get("added_minute") else f"{e['minute']}'"


def _ev(mid: str, key: str, label: str, value, unit: str | None = None, event_ids: list[str] | None = None) -> dict:
    d = {"fact_id": f"{mid}:{key}", "label": label, "value": value}
    if unit:
        d["unit"] = unit
    if event_ids:
        d["event_ids"] = event_ids
    return d


def _surname(name: str | None) -> str:
    if not name:
        return "Unknown"
    if " No. " in name:
        return name
    return name.split(" ")[-1] if " " in name else name


def detect_moments(events: list[dict], meta: dict, wp_at, momentum: list[dict], shifts: dict, final: bool) -> list[dict]:
    """`wp_at(t)` returns win probability just before t; `momentum` is the per-minute series; `shifts` maps side -> shift list."""
    home_id, away_id = meta["home"]["team_id"], meta["away"]["team_id"]
    names = {home_id: meta["home"]["name"], away_id: meta["away"]["name"]}
    side_of = {home_id: "home", away_id: "away"}
    by_id = {e["id"]: e for e in events}
    moments: list[dict] = []
    mid_base = meta["match_id"]

    for e in events:
        t = e["type"]
        if t == "shot":
            xg = e.get("xg", 0.0)
            chain = possession_chain(events, e["id"])
            chain_ids = [c["id"] for c in chain]
            passes = sum(1 for c in chain if c["type"] == "pass")
            xt_chain = round(sum(c.get("xt_added", 0) for c in chain if c.get("xt_added", 0) > 0), 3)
            assist = by_id.get(e.get("assist_event_id")) if e.get("assist_event_id") else None
            breakdown = shot_xg(e, assist.get("pass_type") if assist else None)
            lane = next((f for f in breakdown["factors"] if f["name"] == "Defenders in lane"), None)
            team = e["team_id"]
            opp = away_id if team == home_id else home_id
            if e.get("shot_outcome") == "goal":
                mid = f"mo-goal-{e['id']}"
                before = wp_at(e["t"] - 0.1)
                after = wp_at(e["t"] + 0.1)
                side = side_of[team]
                swing = after[side] - before[side]
                own_goal = "own_goal" in (e.get("tags") or [])
                scorer = e.get("own_goal_by") if own_goal else e.get("player_name")
                score = e["score"]
                factors = [{"name": "Chance quality", "impact": "positive" if xg >= 0.2 else "neutral",
                            "detail": f"{xg:.2f} xG: " + ("a high-quality chance" if xg >= 0.3 else "a chance most players would miss" if xg < 0.1 else "a decent opening")}]
                if assist:
                    factors.append({"name": "Final pass", "impact": "positive",
                                    "detail": f"{assist.get('pass_type', 'pass').replace('_', ' ')} from {assist.get('player_name')}"})
                if passes >= 6:
                    factors.append({"name": "Build-up", "impact": "positive", "detail": f"{passes}-pass move"})
                if e.get("situation") == "counter":
                    factors.append({"name": "Transition", "impact": "positive", "detail": "Scored on the counter before the defence was set"})
                if lane:
                    factors.append({"name": "Through traffic", "impact": "negative", "detail": lane["detail"]})
                if e.get("situation") == "penalty":
                    factors.append({"name": "Penalty", "impact": "positive", "detail": "Converted from the spot"})
                evidence = [_ev(mid, "minute", "Minute", _clock(e), event_ids=[e["id"]]),
                            _ev(mid, "xg", "xG of the chance", xg, event_ids=[e["id"]]),
                            _ev(mid, "score", "Score after the goal", f"{score['home']}-{score['away']}", event_ids=[e["id"]]),
                            _ev(mid, "wp_before", f"{names[team]} win probability before", f"{before[side]:.0%}"),
                            _ev(mid, "wp_after", f"{names[team]} win probability after", f"{after[side]:.0%}")]
                if passes:
                    evidence.append(_ev(mid, "passes", "Passes in the move", passes, event_ids=chain_ids))
                if xt_chain:
                    evidence.append(_ev(mid, "xt", "Threat added in the move (xT)", xt_chain, event_ids=chain_ids))
                if assist:
                    evidence.append(_ev(mid, "assist", "Assist", assist.get("player_name"), event_ids=[assist["id"]]))
                lead = score[side] - score["away" if side == "home" else "home"]
                state = "levels it" if lead == 0 else ("puts them ahead" if lead == 1 else f"makes it a {lead}-goal lead") if lead > 0 else "pulls one back"
                moments.append({
                    "id": mid, "match_id": mid_base, "t": e["t"], "minute": e["minute"], "added_minute": e.get("added_minute"),
                    "type": "goal", "team_id": team, "player_id": e.get("player_id"),
                    "title": f"GOAL: {_surname(scorer)}{' (own goal)' if own_goal else ''} {_clock(e)}",
                    "summary": f"{scorer} {'turns it into his own net' if own_goal else 'scores'} for {names[team]} and {state}: {score['home']}-{score['away']}.",
                    "importance": int(min(100, 62 + 45 * abs(swing))), "confidence": 1.0, "event_ids": chain_ids,
                    "evidence": evidence, "xg": xg, "wp_before": before, "wp_after": after,
                    "explanation": {"why_it_matters": f"{names[team]}'s win probability moved from {before[side]:.0%} to {after[side]:.0%}.",
                                    "factors": factors},
                })
            elif xg >= 0.3 and e.get("situation") != "penalty":
                mid = f"mo-chance-{e['id']}"
                saved = e.get("shot_outcome") == "saved"
                moments.append({
                    "id": mid, "match_id": mid_base, "t": e["t"], "minute": e["minute"], "added_minute": e.get("added_minute"),
                    "type": "save" if saved else "big_chance", "team_id": team, "player_id": e.get("player_id"),
                    "title": f"{'Big save' if saved else 'Big chance'}: {_surname(e.get('player_name'))} {_clock(e)}",
                    "summary": f"{e.get('player_name')} {'is denied by the goalkeeper' if saved else 'misses'} from a {xg:.2f} xG chance for {names[team]}.",
                    "importance": int(min(90, 34 + 60 * xg)), "confidence": 0.9, "event_ids": chain_ids,
                    "evidence": [_ev(mid, "minute", "Minute", _clock(e), event_ids=[e["id"]]),
                                 _ev(mid, "xg", "xG of the chance", xg, event_ids=[e["id"]]),
                                 _ev(mid, "outcome", "Outcome", e.get("shot_outcome", "").replace("_", " "), event_ids=[e["id"]])],
                    "xg": xg,
                    "explanation": {"why_it_matters": f"A chance worth {xg:.2f} goals that {names[opp]} survived.",
                                    "factors": [{"name": f["name"], "impact": "positive" if f["contribution"] > 0 else "negative",
                                                 "detail": f["detail"]} for f in breakdown["factors"][:4]]},
                })
        elif t == "foul" and "penalty_conceded" in (e.get("tags") or []):
            mid = f"mo-pen-{e['id']}"
            awarded_to = away_id if e["team_id"] == home_id else home_id
            moments.append({
                "id": mid, "match_id": mid_base, "t": e["t"], "minute": e["minute"], "added_minute": e.get("added_minute"),
                "type": "penalty", "team_id": awarded_to, "player_id": e.get("player_id"),
                "title": f"Penalty to {names[awarded_to]} {_clock(e)}",
                "summary": f"{e.get('player_name')} brings a player down in the box. Penalty to {names[awarded_to]}.",
                "importance": 58, "confidence": 1.0, "event_ids": [e["id"]],
                "evidence": [_ev(mid, "minute", "Minute", _clock(e), event_ids=[e["id"]]),
                             _ev(mid, "fouler", "Foul by", e.get("player_name"), event_ids=[e["id"]])],
                "explanation": {"why_it_matters": "Penalties are scored about three times in four (0.76 xG).", "factors": []},
            })
        elif t == "card":
            red = e.get("card") in ("red", "second_yellow")
            mid = f"mo-card-{e['id']}"
            before = wp_at(e["t"] - 0.1)
            moments.append({
                "id": mid, "match_id": mid_base, "t": e["t"], "minute": e["minute"], "added_minute": e.get("added_minute"),
                "type": "red_card" if red else "yellow_card", "team_id": e["team_id"], "player_id": e.get("player_id"),
                "title": f"{'Red card' if red else 'Booked'}: {_surname(e.get('player_name'))} {_clock(e)}",
                "summary": f"{e.get('player_name')} ({names[e['team_id']]}) {'is sent off' if red else 'is shown a yellow card'}.",
                "importance": 78 if red else 14, "confidence": 1.0, "event_ids": [e["id"]],
                "evidence": [_ev(mid, "minute", "Minute", _clock(e), event_ids=[e["id"]]),
                             _ev(mid, "card", "Card", e.get("card", "").replace("_", " "), event_ids=[e["id"]])],
                "wp_before": before,
                "explanation": {"why_it_matters": "Ten men concede more and score less: our model cuts their scoring rate by about 28%." if red else "One more foul could mean a second yellow.",
                                "factors": []},
            })

    # tactical shifts
    for side, items in shifts.items():
        team = meta[side]
        for s in items:
            trig = by_id.get(s.get("trigger_event_id"))
            mid = f"mo-shift-{team['team_id']}-{s['trigger_event_id']}"
            moments.append({
                "id": mid, "match_id": mid_base, "t": trig["t"] if trig else 0, "minute": s["minute"], "type": "tactical_shift",
                "team_id": team["team_id"], "title": f"Shape change: {team['name']} {s['from']} to {s['to']}",
                "summary": s["explanation"], "importance": 52, "confidence": s.get("confidence", 0.6),
                "event_ids": [s["trigger_event_id"]] if s.get("trigger_event_id") else [],
                "evidence": [_ev(mid, "from", "Shape before", s["from"]), _ev(mid, "to", "Shape after", s["to"]),
                             _ev(mid, "confidence", "Detection confidence", s.get("confidence", 0.6))],
                "explanation": {"why_it_matters": "Detected from players' average positions before and after the change, not from a team sheet.",
                                "factors": [{"name": "Trigger", "impact": "neutral",
                                             "detail": "Substitution" if trig and trig["type"] == "substitution" else "Red card"}]},
            })

    # momentum swings: sustained spells of territorial threat
    spell_side, spell_start, peak = None, None, 0.0
    last_minute = momentum[-1]["minute"] if momentum else 0
    for point in momentum + [{"minute": last_minute + 1, "value": 0.0}]:
        v = point["value"]
        side = "home" if v >= 0.5 else "away" if v <= -0.5 else None
        if side and side == spell_side:
            peak = max(peak, abs(v))
            continue
        if spell_side and spell_start is not None and point["minute"] - spell_start >= 6:
            team = meta[spell_side]
            end_minute = point["minute"] - 1
            mid = f"mo-mom-{team['team_id']}-{spell_start}"
            ev_ids = [e["id"] for e in events if e["team_id"] == team["team_id"] and e["type"] == "shot"
                      and spell_start <= e["minute"] <= end_minute][:6]
            moments.append({
                "id": mid, "match_id": mid_base, "t": _minute_to_t(spell_start, meta), "minute": spell_start, "type": "momentum_swing",
                "team_id": team["team_id"], "title": f"{team['name']} take control ({spell_start}'-{end_minute}')",
                "summary": f"{team['name']} dominated territory and threat for {end_minute - spell_start + 1} minutes.",
                "importance": int(40 + 25 * peak), "confidence": 0.75, "event_ids": ev_ids,
                "evidence": [_ev(mid, "duration", "Spell length", end_minute - spell_start + 1, "min"),
                             _ev(mid, "peak", "Peak momentum", round(peak, 2)),
                             _ev(mid, "shots", "Shots in the spell", len(ev_ids), event_ids=ev_ids)],
                "explanation": {"why_it_matters": "Momentum is the share of expected threat (xT) and shot quality over a rolling window.",
                                "factors": []},
            })
        spell_side, spell_start, peak = (side, point["minute"], abs(v)) if side else (None, None, 0.0)

    moments.sort(key=lambda m: m["t"])
    if final:
        goals = [m for m in moments if m["type"] == "goal" and m.get("wp_before")]
        if goals:
            def swing(m):
                side = side_of[m["team_id"]]
                return abs(m["wp_after"][side] - m["wp_before"][side])
            tp = max(goals, key=swing)
            tp = dict(tp)
            tp["id"] = f"mo-tp-{tp['event_ids'][-1]}"
            tp["type"] = "turning_point"
            tp["title"] = f"Turning point: {tp['title'].replace('GOAL: ', '')}"
            tp["importance"] = 100
            tp["explanation"] = {**tp["explanation"], "why_it_matters": "The single biggest swing in win probability in the match. " + tp["explanation"]["why_it_matters"]}
            moments.append(tp)
            moments.sort(key=lambda m: m["t"])
    return moments


def _minute_to_t(minute: int, meta: dict) -> float:
    p2 = meta.get("period_starts", [0, 2700])[1]
    return (minute - 1) * 60 if minute <= 45 else p2 + (minute - 46) * 60
