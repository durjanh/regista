"""Assistant coach: turns the Dugout's recommendations into a short, spoken touchline briefing for the manager.

Same pipeline as every narrative: fact sheet -> agent (Azure OpenAI via Agent Framework) -> fact-check -> safety,
with a deterministic offline briefing when Azure AI is not configured.
"""

from __future__ import annotations

import json
import time

from ..store import store
from . import agents
from .agents import AgentSpec
from .factcheck import check, citations_used, strip_unsupported
from .facts import FactSheet
from .offline import cite
from .personas import GROUNDING_RULES, language_name
from .services import moderate, translate


def dugout_sheet(d: dict, meta: dict) -> FactSheet:
    fs = FactSheet()
    team = meta[d["side"]]
    opp = meta["away" if d["side"] == "home" else "home"]
    fs.names |= {team["name"], opp["name"]} | {p["name"] for s in ("home", "away") for p in meta[s]["players"]}
    fs.context.append(f"YOU ARE ADVISING the {team['name']} manager against {opp['name']}. Synthetic match events; real teams.")
    fs.add("Minute", d["minute"])
    fs.add("Score", f"{meta['home']['name']} {d['score']['home']}-{d['score']['away']} {meta['away']['name']}")
    wp = d["win_prob"][d["side"]]
    fs.add(f"{team['name']} win probability now", f"{round(wp * 100)}%")
    for r in d["recommendations"][:5]:
        fs.add(f"Recommendation: {r['title']}", r["detail"])
        sub = r.get("substitution")
        if sub:
            imp = sub["impact"]
            fs.add(f"Impact of '{r['title']}' on win probability", f"{round(imp['wp_before'][d['side']] * 100)}% to {round(imp['wp_after'][d['side']] * 100)}%")
            fs.add(f"Impact of '{r['title']}' on expected goals", f"{imp['xg_delta']:+}")
    for p in d["players"]:
        if p["on_pitch"] and p["status"] in ("struggling", "watch") and p["reasons"]:
            fs.add(f"{p['name']} status", f"{p['status']}: {'; '.join(p['reasons'])}")
    for dm in d["danger_men"][:2]:
        fs.add(f"Danger man {dm['name']}", dm["why"])
    fs.add("Opponent pattern", d["opponent_patterns"]["note"])
    if d["venue"].get("altitude_m"):
        fs.add("Venue altitude", f"{d['venue']['altitude_m']} m")
    return fs


def offline_brief(d: dict, meta: dict, fs: FactSheet) -> str:
    team = meta[d["side"]]
    lines = [f"{d['minute']} minutes, {team['name']} on {round(d['win_prob'][d['side']] * 100)}% to win {cite(fs, 'win probability now')}."]
    for r in d["recommendations"][:3]:
        sub = r.get("substitution")
        if sub:
            imp = sub["impact"]
            lines.append(f"{r['title']}: it takes us from {round(imp['wp_before'][d['side']] * 100)}% to {round(imp['wp_after'][d['side']] * 100)}% {cite(fs, 'Impact of', r['title'], 'win probability')}.")
        else:
            lines.append(f"{r['title']}. {r['detail'].split('. ')[0]} {cite(fs, 'Recommendation: ' + r['title'])}.")
    if len(lines) == 1:
        lines.append("No changes needed right now: the shape is holding.")
    return " ".join(lines)


async def brief(match_id: str, side: str, upto_t: float | None = None, language: str = "en") -> dict:
    from .. import ops
    from ..analytics.dugout import dugout
    ops.current_match.set(match_id)
    started = time.perf_counter()
    an = store.analyzer(match_id)
    sc = store.ensure_scouting()
    d = dugout(an, store.get(match_id), side, upto_t, sc)
    fs = dugout_sheet(d, an.meta)
    trace: list[dict] = [{"agent": "Dugout engine", "action": f"{len(d['recommendations'])} recommendations", "ms": 0}]
    text, engine = "", "offline"
    if agents.mode() != "offline":
        spec = AgentSpec("AssistantCoach", instructions=(
            "You are the assistant coach speaking to the manager on the touchline. 3-5 short, imperative sentences, most "
            f"important first: decisions, then why. Write in {language_name(language)}. {GROUNDING_RULES}\nReturn JSON: {{\"text\": \"...\"}}"))
        try:
            res = await agents.run(spec, fs.render() + "\n\nTASK: Brief the manager now.", json_mode=True, max_tokens=500)
            trace += res.trace
            text = json.loads(res.text).get("text", "")
            engine = "azure"
        except Exception as exc:
            trace.append({"agent": "AssistantCoach", "action": f"fallback to offline engine ({type(exc).__name__})", "ms": 0})
    if not text:
        text = offline_brief(d, an.meta, fs)
        trace.append({"agent": "AssistantCoach (offline engine)", "action": "templated briefing", "ms": 1})
        if language != "en":
            try:
                text = (await translate([text], language))[0]
                trace.append({"agent": "Localizer", "action": f"Azure Translator -> {language}", "ms": 0})
            except Exception:
                pass
    report = check(text, fs)
    if report["issues"]:
        text = strip_unsupported(text, report) or text
        report = check(text, fs)
    if (await moderate(text)).get("flagged"):
        report["passed"] = False
    trace.append({"agent": "Guardrails", "action": "fact-check + content safety", "ms": 0})
    return {"id": f"brief-{match_id}-{side}-{d['minute']}", "match_id": match_id, "scope": "dugout", "persona": "coach",
            "language": language, "text": text, "citations": citations_used(text, fs), "fact_check": report, "engine": engine,
            "latency_ms": int((time.perf_counter() - started) * 1000), "agent_trace": trace}
