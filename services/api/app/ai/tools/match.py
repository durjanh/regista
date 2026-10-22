"""Match tools: state, key moments and why they matter, player stats, tactics, xG, period comparisons."""

from __future__ import annotations

from typing import Annotated

from ...analytics.stats import player_stats, possession_chain, team_stats
from ...analytics.xg import shot_xg
from ...store import store
from .lookup import find_player, minute_to_t
from .registry import tool


@tool()
def list_matches() -> list[dict]:
    """List available matches: real-result rebuilds and generated what-if matches."""
    return [{"match_id": s["match_id"], "home": s["home"]["name"], "away": s["away"]["name"],
             "score": f"{s['final_score']['home']}-{s['final_score']['away']}", "competition": s["competition"],
             "date": s["kickoff"], "kind": (s.get("source") or {}).get("kind", "what_if")} for s in store.summaries()]


@tool()
def get_match_state(match_id: Annotated[str, "Match id, e.g. 2026-07-15-england-argentina"],
                    minute: Annotated[int | None, "Match minute to evaluate (omit for full time)"] = None) -> dict:
    """Score, key stats, momentum and win probability at a given minute."""
    an = store.analyzer(match_id)
    a = an.analyze(minute_to_t(match_id, minute))
    meta = an.meta
    keys = ("goals", "xg", "shots", "shots_on_target", "possession", "pass_completion", "ppda", "field_tilt", "big_chances", "corners")
    return {
        "match": f"{meta['home']['name']} v {meta['away']['name']}", "competition": meta["competition"], "date": meta["kickoff"],
        "minute": a["minute"], "score": a["score"],
        "home": {"team": meta["home"]["name"], **{k: a["stats"]["home"][k] for k in keys}},
        "away": {"team": meta["away"]["name"], **{k: a["stats"]["away"][k] for k in keys}},
        "momentum_now": a["momentum"][-1]["value"] if a["momentum"] else 0,
        "win_probability": {k: round(a["win_prob"][-1][k], 3) for k in ("home", "draw", "away")},
        "pre_match_elo": meta.get("elo"), "real_result": (meta.get("source") or {}).get("kind") == "real_result",
    }


@tool()
def get_key_moments(match_id: Annotated[str, "Match id"], minute: Annotated[int | None, "Up to this minute (omit for all)"] = None,
                    min_importance: Annotated[int, "Only moments at or above this importance (0-100)"] = 40) -> list[dict]:
    """Key moments (goals, big chances, shape changes, momentum swings) with their evidence."""
    a = store.analyzer(match_id).analyze(minute_to_t(match_id, minute))
    return [{"moment_id": m["id"], "minute": m["minute"], "added": m.get("added_minute"), "type": m["type"], "title": m["title"],
             "summary": m["summary"], "importance": m["importance"],
             "evidence": [{"label": e["label"], "value": e["value"]} for e in m["evidence"]]}
            for m in a["moments"] if m["importance"] >= min_importance]


@tool()
def explain_moment(match_id: Annotated[str, "Match id"], moment_id: Annotated[str, "Moment id from get_key_moments"]) -> dict:
    """Why a moment matters: factors, win-probability change, build-up sequence and xG breakdown."""
    an = store.analyzer(match_id)
    m = next((m for m in an.analyze()["moments"] if m["id"] == moment_id), None)
    if not m:
        return {"error": f"Unknown moment {moment_id}"}
    shot_id = next((eid for eid in reversed(m["event_ids"]) if eid in {e["id"] for e in an.events if e["type"] == "shot"}), None)
    out = {"title": m["title"], "summary": m["summary"], "why_it_matters": m["explanation"]["why_it_matters"],
           "factors": m["explanation"]["factors"], "evidence": m["evidence"], "wp_before": m.get("wp_before"), "wp_after": m.get("wp_after")}
    if shot_id:
        out["xg_breakdown"] = get_xg_breakdown(match_id, shot_id)
        chain = possession_chain(an.events, shot_id)
        out["build_up"] = [f"{e['minute']}' {e.get('player_name', '')} {e['type']}{' (' + e['pass_type'] + ')' if e.get('pass_type') else ''}" for e in chain]
    return out


@tool()
def get_player_stats(match_id: Annotated[str, "Match id"], player: Annotated[str, "Player name, surname or id"]) -> dict:
    """A player's match statistics and rating."""
    p = find_player(match_id, player)
    if not p:
        return {"error": f"No player matching '{player}' in this match"}
    doc = store.get(match_id)
    rows = {r["player_id"]: r for r in player_stats(doc["events"], doc["meta"])}
    stats = rows.get(p["player_id"], {})
    return {**stats, "name_source": p.get("name_source", "dataset")}


@tool()
def get_tactical_summary(match_id: Annotated[str, "Match id"], team: Annotated[str | None, "Team name or id (omit for both)"] = None) -> dict:
    """Detected formation, shape changes, pressing (PPDA by 15 minutes), channel usage and key passing links."""
    an = store.analyzer(match_id)
    a = an.analyze()
    out = {}
    for side in ("home", "away"):
        meta_team = an.meta[side]
        if team and team.lower() not in (meta_team["name"].lower(), meta_team["team_id"]):
            continue
        tac = a["tactics"][side]
        names = {p["player_id"]: p["name"] for p in meta_team["players"]}
        links = sorted(tac["pass_network"]["edges"], key=lambda e: -e["count"])[:3]
        out[meta_team["name"]] = {
            "formation_now": tac["formation"], "shape_changes": tac["shifts"], "ppda_by_15_min": tac["ppda"],
            "channels": tac["channels"], "avg_defensive_line_m": tac["avg_line_height"],
            "top_passing_links": [{"between": f"{names.get(e['source'])} & {names.get(e['target'])}", "passes": e["count"]} for e in links],
            "field_tilt": a["stats"][side]["field_tilt"], "ppda": a["stats"][side]["ppda"],
        }
    return out


@tool()
def get_xg_breakdown(match_id: Annotated[str, "Match id"], event_id: Annotated[str, "Shot event id"]) -> dict:
    """Explain a shot's expected goals as additive factors (distance, angle, assist type, defenders in lane...)."""
    doc = store.get(match_id)
    by_id = {e["id"]: e for e in doc["events"]}
    e = by_id.get(event_id)
    if not e or e["type"] != "shot":
        return {"error": "Not a shot event"}
    assist = by_id.get(e.get("assist_event_id")) if e.get("assist_event_id") else None
    b = shot_xg(e, assist.get("pass_type") if assist else None)
    return {"event_id": event_id, "player": e.get("player_name"), "minute": e["minute"], "xg": e.get("xg", b["xg"]), "base": b["base"], "factors": b["factors"]}


@tool()
def compare_periods(match_id: Annotated[str, "Match id"], from_minute: Annotated[int, "Start minute"],
                    to_minute: Annotated[int, "End minute"]) -> dict:
    """Compare both teams over a window of the match (shots, xG, possession, threat)."""
    an = store.analyzer(match_id)
    t0, t1 = minute_to_t(match_id, from_minute) or 0.0, minute_to_t(match_id, to_minute) or an.end_t
    ev = [e for e in an.events if t0 <= e["t"] < t1]
    out = {"window": f"{from_minute}'-{to_minute}'"}
    for side, other in (("home", "away"), ("away", "home")):
        s = team_stats(ev, an.meta[side]["team_id"], an.meta[other]["team_id"])
        out[an.meta[side]["name"]] = {k: s[k] for k in ("goals", "shots", "xg", "possession", "xt", "final_third_entries", "ppda")}
    return out
