"""Offline engine: deterministic, fact-grounded narratives used when Azure AI is not configured (and as a safety net
when a model call fails). Same contract, same citations, same fact-checker as the AI path."""

from __future__ import annotations

import re

from .facts import FactSheet


def cite(fs: FactSheet, *needles: str) -> str:
    """Citation marker for the first fact whose label contains every needle."""
    for f in fs.facts:
        if all(n.lower() in f.label.lower() for n in needles):
            return f"[{f.fact_id}]"
    return ""


def _clock(m: dict) -> str:
    return f"{m['minute']}+{m['added_minute']}'" if m.get("added_minute") else f"{m['minute']}'"


def _pct(v: float) -> str:
    return f"{round(v * 100)}%"


def moment_text(m: dict, meta: dict, persona: str, fs: FactSheet) -> str:
    names = {meta["home"]["team_id"]: meta["home"]["name"], meta["away"]["team_id"]: meta["away"]["name"]}
    team = names.get(m.get("team_id"), "")
    title = m["title"]
    c_sum = cite(fs, title) if title else ""
    xg = m.get("xg")
    c_xg = cite(fs, title, "xG")
    t = m["type"]
    if t in ("goal", "turning_point"):
        side = "home" if m["team_id"] == meta["home"]["team_id"] else "away"
        before, after = m["wp_before"][side], m["wp_after"][side]
        c_wp = cite(fs, title, "win probability after")
        assist = next((e["value"] for e in m["evidence"] if e["label"] == "Assist"), None)
        passes = next((e["value"] for e in m["evidence"] if e["label"] == "Passes in the move"), None)
        if persona == "analyst":
            parts = [f"{m['summary']} {c_sum}", f"The chance was worth {xg:.2f} xG {c_xg}"]
            if passes:
                parts.append(f"at the end of a {passes}-pass move {cite(fs, title, 'Passes in the move')}")
            return f"{parts[0]} {', '.join(parts[1:])}, and it moves {team}'s win probability from {_pct(before)} to {_pct(after)} {c_wp}."
        if persona == "kids":
            return (f"GOAL for {team}! {m['summary']} {c_sum} Before the goal they had a {_pct(before)} chance of winning, "
                    f"now it's {_pct(after)} {c_wp}. That's like going from a coin flip to a much better bet!").replace(
                "a much better bet", "being clear favourites" if after > 0.6 else "a real fight")
        if persona == "fantasy":
            return (f"{m['summary']} {c_sum}" + (f" Assist points for {assist} {cite(fs, title, 'Assist')}." if assist else "") +
                    f" Chance quality {xg:.2f} xG {c_xg}.")
        if persona == "social":
            return f"⚽ {m['summary']} {c_sum} Win probability now {_pct(after)} {c_wp}."
        if persona == "accessible":
            return f"Goal. {_clock(m)}. {m['summary']} {c_sum} {team} now have a {_pct(after)} chance of winning {c_wp}."
        if persona == "broadcaster":
            return (f"{m['summary']} {c_sum} Talking point: the win probability swing, {_pct(before)} to {_pct(after)} {c_wp}, "
                    f"from a {xg:.2f} xG chance {c_xg}.")
        quality = "a great chance" if xg >= 0.3 else "a chance most players would miss" if xg < 0.1 else "a decent chance"
        if after < 0.03:
            return f"{m['summary']} {c_sum} It was {quality}, worth {xg:.2f} xG {c_xg}, but it comes too late to change the outcome."
        return f"{m['summary']} {c_sum} It was {quality}, worth {xg:.2f} xG {c_xg}, and {team} go from {_pct(before)} to {_pct(after)} to win {c_wp}."
    if t in ("big_chance", "save"):
        verb = "kept out by the goalkeeper" if t == "save" else "missed"
        if persona == "analyst":
            factors = "; ".join(f["detail"] for f in m["explanation"]["factors"][:2])
            return f"{m['summary']} {c_sum} A {xg:.2f} xG opportunity {c_xg} ({factors})."
        if persona == "kids":
            return f"Ooh, so close! {m['summary']} {c_sum} Chances like that go in about {round(xg * 10)} times out of 10 {cite(fs, title, 'times in 10')}."
        return f"{m['summary']} {c_sum} That was a {xg:.2f} xG chance {c_xg}, {verb}."
    if t == "tactical_shift":
        return f"{m['title']} {c_sum}. {m['summary']} {m['explanation']['why_it_matters']}"
    if t == "momentum_swing":
        dur = next((e["value"] for e in m["evidence"] if e["label"] == "Spell length"), None)
        return f"{m['summary']} {c_sum}" + (f" A {dur}-minute spell {cite(fs, title, 'Spell length')}." if dur else "")
    return f"{m['summary']} {c_sum}"


def live_line(e: dict, meta: dict) -> str | None:
    """One-line commentary for notable events in the live feed (no numbers beyond the clock)."""
    names = {meta["home"]["team_id"]: meta["home"]["name"], meta["away"]["team_id"]: meta["away"]["name"]}
    who = e.get("player_name", "")
    team = names.get(e["team_id"], "")
    t = e["type"]
    if t == "shot":
        out = e.get("shot_outcome")
        if out == "goal":
            return f"GOAL! {who} scores for {team}."
        return {"saved": f"{who} forces a save.", "off_target": f"{who} shoots wide.", "blocked": f"{who}'s shot is blocked.",
                "post": f"{who} hits the woodwork!"}.get(out, f"{who} shoots.")
    if t == "corner":
        return f"Corner to {team}."
    if t == "card":
        return f"{who} is {'sent off' if e.get('card') in ('red', 'second_yellow') else 'booked'}."
    if t == "substitution":
        return f"Change for {team}."
    if t == "foul" and "penalty_conceded" in (e.get("tags") or []):
        return f"Penalty! {who} brings a man down in the box."
    if t == "offside":
        return f"{who} is flagged offside."
    return None


def headline(meta: dict, analysis: dict) -> str:
    h, a = meta["home"]["name"], meta["away"]["name"]
    sc = analysis["score"]
    hint = meta.get("headline_hint", "")
    if sc["home"] == sc["away"]:
        return f"{h} and {a} share the spoils in a {sc['home']}-{sc['away']} draw"
    w, lo = (h, a) if sc["home"] > sc["away"] else (a, h)
    if hint == "Giant-killing":
        return f"Giant-killing: {w} stun {lo}"
    if hint == "The comeback":
        return f"{w} come from behind to beat {lo}"
    if hint == "Late drama":
        return f"Late drama as {w} edge {lo}"
    if hint == "Goal fest":
        return f"{w} win a goal fest against {lo}"
    return f"{w} beat {lo} {max(sc.values())}-{min(sc.values())}"


def recap(meta: dict, analysis: dict, fs: FactSheet, persona: str) -> dict:
    h, a = meta["home"]["name"], meta["away"]["name"]
    sh, sa = analysis["stats"]["home"], analysis["stats"]["away"]
    sc = analysis["score"]
    real = (meta.get("source") or {}).get("real")
    goals = [m for m in analysis["moments"] if m["type"] == "goal"]
    tp = next((m for m in analysis["moments"] if m["type"] == "turning_point"), None)
    hl = headline(meta, analysis)
    standfirst = (f"{meta['competition']}, {meta['venue']}, {meta['kickoff']}. "
                  f"{h} {sc['home']}-{sc['away']} {a} {cite(fs, 'Score')}.")
    paras = [f"## {hl}", standfirst]
    if real:
        scorers = ", ".join(f"{g['scorer']} {g['minute']}'{' (pen)' if g['penalty'] else ''}" for g in real["goals"]) or "no goals"
        paras.append(f"**Real result.** Goals: {scorers} {cite(fs, 'Real goal')}. The ball-by-ball detail below is Regista's synthetic reconstruction around those real goals.")
    wp0 = analysis["win_prob"][0]
    paras.append(f"Before kick-off our model, built on Elo ratings from every international since 1872, gave {h} {_pct(wp0['home'])}, "
                 f"the draw {_pct(wp0['draw'])} and {a} {_pct(wp0['away'])} {cite(fs, 'Pre-match win probability')}.")
    better = h if sh["xg"] > sa["xg"] else a
    paras.append(f"On chances, {h} created {sh['xg']} xG {cite(fs, 'xG ' + h)} to {a}'s {sa['xg']} {cite(fs, 'xG ' + a)}, "
                 f"so {better} carved out the better opportunities. Possession split {_pct(sh['possession'])} to {_pct(sa['possession'])} "
                 f"{cite(fs, 'Possession ' + h)}.")
    if goals:
        paras.append("### How the goals came")
        for g in goals:
            paras.append(f"- **{_clock(g)}** {moment_text(g, meta, 'analyst' if persona == 'analyst' else 'casual', fs)}")
    if tp:
        paras.append(f"### Turning point\n{tp['explanation']['why_it_matters']} {cite(fs, tp['title'])}")
    shifts = [(meta[s]["name"], x) for s in ("home", "away") for x in analysis["tactics"][s]["shifts"]]
    if shifts:
        paras.append("### Tactics")
        for team, s in shifts:
            paras.append(f"- {team} changed shape at {s['minute']}', {s['from']} to {s['to']} {cite(fs, team + ' shape change')}. {s['explanation']}")
    pom = analysis["top_players"][0] if analysis["top_players"] else None
    if pom:
        paras.append(f"### Player of the match\n{pom['name']} rated {pom['rating']} {cite(fs, 'Player rating ' + pom['name'])}.")
    report = "\n\n".join(paras)
    social = [
        {"platform": "x", "text": f"FT: {h} {sc['home']}-{sc['away']} {a}. xG {sh['xg']}-{sa['xg']}. {hl}."},
        {"platform": "instagram", "text": f"{hl} ⚽ {h} {sc['home']}-{sc['away']} {a}."},
        {"platform": "whatsapp", "text": f"Full time: {h} {sc['home']}-{sc['away']} {a}."},
    ]
    script = (f"Full time: {h} {sc['home']}, {a} {sc['away']}. " +
              " ".join(f"{g['minute']} minutes: {g['summary']}" for g in goals[:6]) +
              f" On expected goals it finished {sh['xg']} to {sa['xg']}.")
    return {"headline": hl, "standfirst": standfirst, "report_md": report, "social_posts": social, "audio_script": script}


QUESTION_ROUTES = [
    (r"\b(conced|goal|scor|winner|equalis|equaliz)", "goals"),
    (r"\b(shape|formation|tactic|system|back three|back four|back five)", "tactics"),
    (r"\b(press|ppda)", "pressing"),
    (r"\b(midfield|control|dominat|momentum|on top|after the break|second half|first half)", "control"),
    (r"\b(head to head|head-to-head|h2h|history|record|met before|previous meeting)", "h2h"),
    (r"\b(best player|player of|star|rating|man of the match|standout)", "players"),
    (r"\b(xg|chance|chances|expected goals)", "chances"),
]
ORDINALS = {"first": 0, "opening": 0, "opener": 0, "second": 1, "third": 2, "fourth": 3, "fifth": 4, "last": -1, "winner": -1, "late": -1}


def route(question: str) -> str:
    q = question.lower()
    for pattern, intent in QUESTION_ROUTES:
        if re.search(pattern, q):
            return intent
    return "summary"


def pick_goals(question: str, goals: list[dict], meta: dict) -> list[dict]:
    """Narrow goal moments to the ones a question is about ("why did England concede the second?")."""
    q = question.lower()
    team_ids = {meta[s]["name"].lower(): meta[s]["team_id"] for s in ("home", "away")}
    named = [tid for name, tid in team_ids.items() if name in q]
    if named:
        tid = named[0]
        if "conced" in q or "let in" in q:
            goals = [g for g in goals if g["team_id"] != tid]
        elif "scor" in q:
            goals = [g for g in goals if g["team_id"] == tid]
    for word, idx in ORDINALS.items():
        if re.search(rf"\b{word}\b", q) and goals:
            return [goals[idx]] if -len(goals) <= idx < len(goals) else goals
    return goals
