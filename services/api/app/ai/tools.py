"""Match-intelligence tools shared by the MCP server, the Agent Framework agents and the OpenAI tool loop.

Each tool returns compact, citation-ready JSON: numbers come straight from the analytics engine or the real
results dataset, never from a model.
"""

from __future__ import annotations

from typing import Annotated

from ..analytics.engine import minute_of
from ..analytics.stats import player_stats, possession_chain, team_stats
from ..analytics.xg import shot_xg
from ..forge.reference import reference, slug
from ..store import store


def _t_for_minute(match_id: str, minute: int | None) -> float | None:
    if minute is None:
        return None
    meta = store.get(match_id)["meta"]
    p2 = meta.get("period_starts", [0, 2700])[1]
    return minute * 60.0 if minute <= 45 else p2 + (minute - 45) * 60.0


def _find_player(match_id: str, name_or_id: str) -> dict | None:
    meta = store.get(match_id)["meta"]
    q = name_or_id.lower().strip()
    for side in ("home", "away"):
        for p in meta[side]["players"]:
            if p["player_id"].lower() == q or p["name"].lower() == q or p["name"].lower().split(" ")[-1] == q or q in p["name"].lower():
                return p
    return None


def list_matches() -> list[dict]:
    """List available matches: real-result rebuilds and generated what-if matches."""
    return [{"match_id": s["match_id"], "home": s["home"]["name"], "away": s["away"]["name"],
             "score": f"{s['final_score']['home']}-{s['final_score']['away']}", "competition": s["competition"],
             "date": s["kickoff"], "kind": (s.get("source") or {}).get("kind", "what_if")} for s in store.summaries()]


def get_match_state(match_id: Annotated[str, "Match id, e.g. 2026-07-15-england-argentina"],
                    minute: Annotated[int | None, "Match minute to evaluate (omit for full time)"] = None) -> dict:
    """Score, key stats, momentum and win probability at a given minute."""
    an = store.analyzer(match_id)
    a = an.analyze(_t_for_minute(match_id, minute))
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


def get_key_moments(match_id: Annotated[str, "Match id"], minute: Annotated[int | None, "Up to this minute (omit for all)"] = None,
                    min_importance: Annotated[int, "Only moments at or above this importance (0-100)"] = 40) -> list[dict]:
    """Key moments (goals, big chances, shape changes, momentum swings) with their evidence."""
    a = store.analyzer(match_id).analyze(_t_for_minute(match_id, minute))
    return [{"moment_id": m["id"], "minute": m["minute"], "added": m.get("added_minute"), "type": m["type"], "title": m["title"],
             "summary": m["summary"], "importance": m["importance"],
             "evidence": [{"label": e["label"], "value": e["value"]} for e in m["evidence"]]}
            for m in a["moments"] if m["importance"] >= min_importance]


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


def get_player_stats(match_id: Annotated[str, "Match id"], player: Annotated[str, "Player name, surname or id"]) -> dict:
    """A player's match statistics and rating."""
    p = _find_player(match_id, player)
    if not p:
        return {"error": f"No player matching '{player}' in this match"}
    doc = store.get(match_id)
    rows = {r["player_id"]: r for r in player_stats(doc["events"], doc["meta"])}
    stats = rows.get(p["player_id"], {})
    return {**stats, "name_source": p.get("name_source", "dataset")}


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


def compare_periods(match_id: Annotated[str, "Match id"], from_minute: Annotated[int, "Start minute"],
                    to_minute: Annotated[int, "End minute"]) -> dict:
    """Compare both teams over a window of the match (shots, xG, possession, threat)."""
    an = store.analyzer(match_id)
    t0, t1 = _t_for_minute(match_id, from_minute) or 0.0, _t_for_minute(match_id, to_minute) or an.end_t
    ev = [e for e in an.events if t0 <= e["t"] < t1]
    out = {"window": f"{from_minute}'-{to_minute}'"}
    for side, other in (("home", "away"), ("away", "home")):
        s = team_stats(ev, an.meta[side]["team_id"], an.meta[other]["team_id"])
        out[an.meta[side]["name"]] = {k: s[k] for k in ("goals", "shots", "xg", "possession", "xt", "final_third_entries", "ppda")}
    return out


def get_head_to_head(team_a: Annotated[str, "Team name or id"], team_b: Annotated[str, "Team name or id"],
                     before_date: Annotated[str | None, "Only matches before this date (YYYY-MM-DD)"] = None) -> dict:
    """Real head-to-head record between two national teams from 49,945 results (1872-2026)."""
    ref = reference()
    a = ref.names.get(slug(team_a), team_a)
    b = ref.names.get(slug(team_b), team_b)
    return {"team_a": a, "team_b": b, **ref.h2h(a, b, before_date), "source": "International results 1872-2026 (CC0)"}


def get_team_history(team: Annotated[str, "Team name or id"]) -> dict:
    """Real all-time record, current Elo and rank, recent results and top scorers for a national team."""
    d = reference().team_detail(slug(team))
    d["elo_history"] = d["elo_history"][-12:]
    return d


def generate_what_if(home_team: Annotated[str, "Home team name or id"], away_team: Annotated[str, "Away team name or id"],
                     scenario: Annotated[str, "balanced, late_drama, comeback, red_card, derby, tactical_chess, goal_fest or underdog"] = "balanced") -> dict:
    """Generate a synthetic what-if match between two real national teams (strength from Elo) and return its id."""
    from ..forge.matches import build_what_if
    doc = build_what_if(slug(home_team), slug(away_team), scenario=scenario)
    store.add_generated(doc)
    m = doc["meta"]
    return {"match_id": m["match_id"], "score": m["final_score"], "headline": m["headline_hint"], "elo": m["elo"]}


def get_player_dna(player: Annotated[str, "Player name or player key, e.g. 'Harry Kane' or 'england:harry-kane'"]) -> dict:
    """Scouting report: REAL international record plus MODEL tendencies (shot sides, feet, penalty placement, keeper dives,
    physical output), strengths, weaknesses and how to stop him."""
    sc = store.ensure_scouting()
    key = player if ":" in player else next((k for k, a in sc.players.items() if a["name"].lower() == player.lower()), None)
    if not key:
        key = next((k for k, a in sc.players.items() if player.lower() in a["name"].lower()), None)
    if not key:
        return {"error": f"No scouting profile for '{player}'"}
    d = sc.player_dna(key)
    d["model"].pop("shot_map", None)
    d["model"].pop("goal_map", None)
    return d


def get_team_report(team: Annotated[str, "Team name or id, e.g. 'Argentina'"]) -> dict:
    """Team scouting report: REAL home/away/neutral record, MODEL leaders (distance, passes, threat), penalty takers,
    keeper tendencies, danger men and how to play against them."""
    return store.ensure_scouting().team_report(slug(team))


def get_dugout_advice(match_id: Annotated[str, "Match id"], side: Annotated[str, "'home' or 'away': the team you manage"],
                      minute: Annotated[int | None, "Match minute (omit for full time)"] = None) -> dict:
    """Live manager advice: player form vs baseline, fatigue, substitution recommendations with win-probability impact,
    tactical alerts and danger men."""
    from ..analytics.dugout import dugout
    d = dugout(store.analyzer(match_id), store.get(match_id), side, _t_for_minute(match_id, minute), store.ensure_scouting())
    return {k: d[k] for k in ("minute", "score", "win_prob", "recommendations", "danger_men", "opponent_patterns")} | {
        "players": [{k: p[k] for k in ("name", "position", "rating", "baseline", "status", "reasons")} for p in d["players"] if p["on_pitch"]]}


TOOLS = [list_matches, get_match_state, get_key_moments, explain_moment, get_player_stats, get_tactical_summary,
         get_xg_breakdown, compare_periods, get_head_to_head, get_team_history, get_player_dna, get_team_report,
         get_dugout_advice, generate_what_if]
READ_ONLY_TOOLS = [t for t in TOOLS if t is not generate_what_if]


def openai_tool_specs(tools=READ_ONLY_TOOLS) -> list[dict]:
    """OpenAI function-calling specs derived from the tool signatures."""
    import inspect
    import typing
    specs = []
    for fn in tools:
        sig = inspect.signature(fn)
        hints = typing.get_type_hints(fn, include_extras=True)
        props, required = {}, []
        for name, param in sig.parameters.items():
            hint = hints.get(name, str)
            desc = ""
            base = hint
            if typing.get_origin(hint) is typing.Annotated:
                base, desc = typing.get_args(hint)[0], typing.get_args(hint)[1]
            args = typing.get_args(base)
            base_t = next((a for a in args if a is not type(None)), base) if args else base
            js = "integer" if base_t is int else "number" if base_t is float else "string"
            props[name] = {"type": js, "description": desc}
            if param.default is inspect.Parameter.empty:
                required.append(name)
        specs.append({"type": "function", "function": {"name": fn.__name__, "description": (fn.__doc__ or "").strip(),
                                                       "parameters": {"type": "object", "properties": props, "required": required}}})
    return specs


def call_tool(name: str, args: dict):
    fn = next((t for t in TOOLS if t.__name__ == name), None)
    if not fn:
        return {"error": f"unknown tool {name}"}
    try:
        return fn(**args)
    except Exception as exc:  # tools must never crash an agent run
        return {"error": str(exc)}


__all__ = ["TOOLS", "READ_ONLY_TOOLS", "openai_tool_specs", "call_tool", "minute_of"]
