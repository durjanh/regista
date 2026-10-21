"""Ask Regista: a conversational analyst agent grounded in the match data.

With Foundry configured, the MatchAnalyst agent (Agent Framework) calls the Regista MCP server's tools; with only
Azure OpenAI it uses the same tools via function calling; offline, an intent router calls the tools directly.
Answers are fact-checked against the fact sheet plus every number the tools returned.
"""

from __future__ import annotations

import time

from ..config import settings
from ..store import store
from . import agents
from .agents import AgentSpec
from .factcheck import check, citations_used
from .facts import Fact, full_sheet
from .offline import cite, pick_goals, route
from .personas import GROUNDING_RULES, language_name, persona_guide
from .services import shield_prompt, translate
from .tools import call_tool


def _flatten(prefix: str, obj, out: list[tuple[str, object]]) -> None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            _flatten(f"{prefix}.{k}" if prefix else k, v, out)
    elif isinstance(obj, list):
        for i, v in enumerate(obj[:30]):
            _flatten(f"{prefix}[{i}]", v, out)
    else:
        out.append((prefix, obj))


async def ask(match_id: str, question: str, persona: str = "casual", language: str = "en",
              upto_t: float | None = None, history: list[dict] | None = None) -> dict:
    from .. import ops
    ops.current_match.set(match_id)
    started = time.perf_counter()
    an = store.analyzer(match_id)
    t = an.end_t if upto_t is None else min(upto_t, an.end_t)
    analysis = an.analyze(t)
    meta = an.meta
    fs = full_sheet(meta, analysis, max_moments=8)
    trace: list[dict] = []
    if await shield_prompt(question):
        return {"answer": "I can only help with questions about this match.", "citations": [], "tool_calls": [],
                "engine": "azure", "fact_check": {"passed": True, "checked_claims": 0, "issues": [], "bias_flags": []},
                "agent_trace": [{"agent": "Guardrails", "action": "Prompt Shields blocked the request", "ms": 0}]}
    minute_note = f"The user is watching at minute {analysis['minute']}; do not reveal anything after that." if upto_t is not None else ""
    tool_calls: list[dict] = []
    engine = "offline"
    answer = ""
    if agents.mode() != "offline":
        spec = AgentSpec("MatchAnalyst", tools=True, instructions=(
            f"You are Regista, a football analyst answering questions about one match (match_id={match_id}). "
            f"Voice: {persona_guide(persona)} Write in {language_name(language)}. {minute_note}\n"
            f"Use the facts first; call tools for anything else (player stats, xG breakdowns, period comparisons, "
            f"real head-to-head and team history). Cite facts as [fN] when you use them.\n{GROUNDING_RULES}"))
        convo = "\n".join(f"{h['role'].upper()}: {h['content']}" for h in (history or [])[-6:])
        convo_block = ("CONVERSATION SO FAR:\n" + convo + "\n\n") if convo else ""
        prompt = fs.render() + "\n\n" + convo_block + "QUESTION: " + question
        try:
            res = await agents.run(spec, prompt, use_mcp=True)
            answer, tool_calls = res.text, res.tool_calls
            trace += res.trace
            engine = "azure" if answer else engine     # an empty reply falls through to the offline engine below
        except Exception as exc:
            trace.append({"agent": "MatchAnalyst", "action": f"fallback to offline engine ({type(exc).__name__})", "ms": 0})
    if not answer:
        answer, tool_calls = _offline_answer(match_id, question, analysis, meta, fs, trace)
        if language != "en" and settings.translator:
            try:
                answer = (await translate([answer], language))[0]
                trace.append({"agent": "Localizer", "action": f"Azure Translator -> {language}", "ms": 0})
            except Exception:
                pass
    # numbers returned by tools are legitimate evidence too
    for call in tool_calls:
        if call.get("result") is not None:
            leaves: list[tuple[str, object]] = []
            _flatten(call["tool"], call["result"], leaves)
            for label, value in leaves:
                if isinstance(value, (int, float, str)) and any(ch.isdigit() for ch in str(value)):
                    fs.facts.append(Fact(f"t{len(fs.facts)}", label, value))
    report = check(answer, fs)
    trace.append({"agent": "FactChecker", "action": f"verified {report['checked_claims']} claims", "ms": 1})
    return {"answer": answer, "citations": citations_used(answer, fs),
            "tool_calls": [{"tool": c["tool"], "args": c["args"], "ms": c.get("ms", 0)} for c in tool_calls],
            "engine": engine, "fact_check": report, "agent_trace": trace,
            "latency_ms": int((time.perf_counter() - started) * 1000)}


def _offline_answer(match_id: str, question: str, analysis: dict, meta: dict, fs, trace: list[dict]) -> tuple[str, list[dict]]:
    intent = route(question)
    calls: list[dict] = []

    def tool(name: str, **args):
        ts = time.perf_counter()
        result = call_tool(name, args)
        ms = int((time.perf_counter() - ts) * 1000)
        calls.append({"tool": name, "args": args, "ms": ms, "result": result})
        trace.append({"agent": "MatchAnalyst (offline engine)", "action": f"tool: {name}", "ms": ms})
        return result

    h, a = meta["home"]["name"], meta["away"]["name"]
    minute = analysis["minute"] if analysis["t"] < store.analyzer(match_id).end_t else None
    if intent == "goals":
        moments = [m for m in tool("get_key_moments", match_id=match_id, minute=minute, min_importance=0) if m["type"] == "goal"]
        full = {m["id"]: m for m in analysis["moments"]}
        moments = pick_goals(question, [dict(full[m["moment_id"]], moment_id=m["moment_id"]) for m in moments if m["moment_id"] in full], meta)
        if not moments:
            return "No goals match that question yet.", calls
        lines = []
        for m in moments:
            ex = tool("explain_moment", match_id=match_id, moment_id=m["moment_id"])
            factors = "; ".join(f["detail"] for f in ex.get("factors", [])[:4])
            build = ex.get("build_up") or []
            route_txt = f" The move: {' → '.join(b.split(' ', 1)[1] for b in build[-4:])}." if build else ""
            lines.append(f"{m['summary']} {cite(fs, m['title'])} Why: {factors}.{route_txt}")
        return " ".join(lines), calls
    if intent in ("tactics", "pressing"):
        tac = tool("get_tactical_summary", match_id=match_id)
        parts = []
        for team, d in tac.items():
            shifts = ", ".join(f"{s['from']} to {s['to']} at {s['minute']}'" for s in d["shape_changes"]) or "no detected shape change"
            parts.append(f"{team} set up as {d['formation_now']['detected']} with a PPDA of {d['ppda']} {cite(fs, 'PPDA ' + team)} ({shifts}).")
        return " ".join(parts) + " Lower PPDA means more aggressive pressing.", calls
    if intent == "control":
        first = tool("compare_periods", match_id=match_id, from_minute=1, to_minute=45)
        second = tool("compare_periods", match_id=match_id, from_minute=46, to_minute=analysis["minute"] if minute else 95)
        return (f"First half: {h} {first[h]['shots']} shots and {first[h]['xg']} xG against {a}'s {first[a]['shots']} and {first[a]['xg']}. "
                f"After the break: {h} {second[h]['shots']} shots ({second[h]['xg']} xG), {a} {second[a]['shots']} ({second[a]['xg']} xG)."), calls
    if intent == "h2h":
        d = tool("get_head_to_head", team_a=h, team_b=a, before_date=meta["kickoff"])
        return (f"Before this match the real record was {d['played']} meetings: {h} won {d['home_wins']}, {d['draws']} draws, "
                f"{a} won {d['away_wins']} {cite(fs, 'Head-to-head')}."), calls
    if intent == "players":
        top = analysis["top_players"][:3]
        return "Top performers by match rating: " + ", ".join(f"{p['name']} {p['rating']} {cite(fs, 'Player rating ' + p['name'])}" for p in top) + ".", calls
    if intent == "chances":
        state = tool("get_match_state", match_id=match_id, minute=minute)
        return (f"Expected goals: {h} {state['home']['xg']} {cite(fs, 'xG ' + h)}, {a} {state['away']['xg']} {cite(fs, 'xG ' + a)}. "
                f"Big chances: {state['home']['big_chances']} to {state['away']['big_chances']}."), calls
    state = tool("get_match_state", match_id=match_id, minute=minute)
    wp = state["win_probability"]
    return (f"{h} {state['score']['home']}-{state['score']['away']} {a} at {state['minute']}' {cite(fs, 'Score')}. "
            f"xG {state['home']['xg']}-{state['away']['xg']}; win probability {round(wp['home'] * 100)}% / "
            f"{round(wp['draw'] * 100)}% / {round(wp['away'] * 100)}% {cite(fs, 'Win probability now')}."), calls
