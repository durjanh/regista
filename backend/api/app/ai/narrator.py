"""Narrator: grounded, persona-aware, multilingual narratives for moments, half time and full time.

Pipeline: fact sheet -> Narrator agent (Azure OpenAI via Agent Framework) -> deterministic fact-check ->
one repair round if needed -> Content Safety -> cache. Offline engine when Azure AI is not configured.
"""

from __future__ import annotations

import hashlib
import json
import logging
import random
import time

from ..config import settings
from ..store import store
from . import agents
from .agents import AgentSpec
from .factcheck import check, citations_used, plant_error, strip_unsupported
from .facts import FactSheet, base_sheet, full_sheet, moment_sheet
from .offline import moment_text
from .personas import GROUNDING_RULES, language_name, persona_guide
from .services import moderate, translate

log = logging.getLogger("regista.narrator")
_cache: dict[str, dict] = {}


def _key(*parts) -> str:
    return hashlib.sha1(json.dumps(parts, default=str).encode()).hexdigest()[:16]


def narrator_spec(persona: str, language: str) -> AgentSpec:
    return AgentSpec(
        name="Narrator",
        instructions=(f"You are Regista's match narrator. Voice: {persona_guide(persona)}\n"
                      f"Write in {language_name(language)}.\n{GROUNDING_RULES}\n"
                      'Return JSON: {"text": "..."}'),
    )


async def _generate(fs: FactSheet, task: str, persona: str, language: str, trace: list[dict]) -> str:
    spec = narrator_spec(persona, language)
    res = await agents.run(spec, f"{fs.render()}\n\nTASK: {task}", json_mode=True, max_tokens=700)
    trace += res.trace
    try:
        return json.loads(res.text).get("text", "").strip()
    except json.JSONDecodeError:
        return res.text.strip()


async def narrate(match_id: str, scope: str, persona: str = "casual", language: str = "en",
                  moment_id: str | None = None, upto_t: float | None = None) -> dict:
    an = store.analyzer(match_id)
    t = an.end_t if upto_t is None else min(upto_t, an.end_t)
    cache_key = _key(match_id, scope, moment_id, persona, language, round(t / 60) if scope in ("halftime", "live_line") else None)
    if cache_key in _cache:
        return _cache[cache_key]
    from .. import ops
    ops.current_match.set(match_id)
    started = time.perf_counter()
    analysis = an.analyze(t)
    meta = an.meta
    trace: list[dict] = []
    moment = None
    if scope == "moment":
        moment = next((m for m in analysis["moments"] if m["id"] == moment_id), None) or \
                 next((m for m in an.analyze()["moments"] if m["id"] == moment_id), None)
        if not moment:
            raise KeyError(moment_id)
        fs = moment_sheet(meta, analysis, moment)
        task = "Narrate the FOCUS MOMENT for this audience and explain why it matters. Cite facts."
    elif scope == "halftime":
        fs = full_sheet(meta, analysis, max_moments=6)
        task = "Half-time analysis: what has decided the game so far and what to watch in the second half. 4-6 sentences. Cite facts."
    elif scope == "fulltime":
        fs = full_sheet(meta, analysis)
        task = "Full-time verdict: who deserved what and why, in 4-6 sentences. Cite facts."
    else:
        fs = base_sheet(meta, analysis)
        task = "One line of live commentary on the current state of the match. Cite facts."

    engine = "offline"
    text = ""
    if agents.mode() != "offline":
        try:
            text = await _generate(fs, task, persona, language, trace)
            report = check(text, fs)
            trace.append({"agent": "FactChecker", "action": f"verified {report['checked_claims']} claims", "ms": 1})
            if not report["passed"] and text:
                problems = "; ".join(i["problem"] for i in report["issues"][:6]) + "; ".join(b["phrase"] for b in report["bias_flags"])
                text = await _generate(fs, f"{task}\nYour previous draft failed fact-checking: {problems}. Rewrite it using only the facts.",
                                       persona, language, trace)
                trace.append({"agent": "FactChecker", "action": "repair round", "ms": 1})
            engine = "azure"
        except Exception as exc:
            log.warning("Narrator AI path failed, using offline engine: %s", exc)
            trace.append({"agent": "Narrator", "action": f"fallback to offline engine ({type(exc).__name__})", "ms": 0})
            text = ""
    if not text:
        ts = time.perf_counter()
        if moment:
            text = moment_text(moment, meta, persona, fs)
        else:
            from .offline import recap as offline_recap
            text = offline_recap(meta, analysis, fs, persona)["standfirst"] if scope != "live_line" else \
                f"{meta['home']['name']} {analysis['score']['home']}-{analysis['score']['away']} {meta['away']['name']} [f1]."
        trace.append({"agent": "Narrator (offline engine)", "action": "templated grounded narrative", "ms": int((time.perf_counter() - ts) * 1000)})
        if language != "en" and settings.translator:
            try:
                text = (await translate([text], language))[0]
                trace.append({"agent": "Localizer", "action": f"Azure Translator -> {language}", "ms": 0})
            except Exception as exc:
                log.warning("Translator failed: %s", exc)

    report = check(text, fs)
    if not report["passed"] and report["issues"]:
        text = strip_unsupported(text, report) or text
        report = check(text, fs)
    safety = await moderate(text)
    if safety.get("flagged"):
        report["issues"].append({"sentence": "", "problem": "Content Safety flagged the text"})
        report["passed"] = False
        text = moment["summary"] if moment else text
    trace.append({"agent": "Guardrails", "action": "fact-check + fair commentary + content safety", "ms": 0})
    result = {
        "id": f"nar-{cache_key}", "match_id": match_id, "scope": scope, "moment_id": moment_id, "persona": persona,
        "language": language, "text": text, "citations": citations_used(text, fs), "fact_check": report,
        "engine": engine, "latency_ms": int((time.perf_counter() - started) * 1000), "agent_trace": trace,
    }
    _cache[cache_key] = result
    ops.record_latency(result["latency_ms"])
    return result


def insight_sheet(an, insight: dict) -> FactSheet:
    """The evidence a detected change may be explained with: match state at detection plus the feature before/after."""
    fs = base_sheet(an.meta, an.analyze(insight["detected_t"]))
    fs.context.append(f"DETECTED CHANGE ({insight['mechanism'].replace('_', ' ')}): {insight['title']}.")
    fs.add(f"{insight['feature']['label']} before {insight['feature']['change_minute']}'", insight["feature"]["before"])
    fs.add(f"{insight['feature']['label']} after {insight['feature']['change_minute']}'", insight["feature"]["after"])
    fs.add("Change detected at minute", insight["detected_minute"])
    fs.add("Change began around minute", insight["start_minute"])
    for e in insight["evidence"]:
        if e["fact_id"].endswith((":sprints",)):
            fs.add(e["label"], e["value"])
    return fs


async def narrate_insight(match_id: str, insight: dict, persona: str = "analyst", language: str = "en", drill: bool = False) -> dict:
    """Analyst drafts a line from a detector's structured insight; the Verifier (fact-checker) checks every number
    against the insight's own evidence and sends failures back for one rewrite. Offline: the structured sentence.

    drill=True is the Verifier drill: one supported number in the Analyst's draft is overstated on purpose (a planted
    claim error, like a planted tactical change) so the catch and the rewrite are visible. A known-bad draft never airs:
    if the Verifier missed it, the clean draft is used and the miss is recorded."""
    cache_key = _key(match_id, "insight", insight["id"], persona, language, "drill" if drill else None)
    if cache_key in _cache:
        return _cache[cache_key]
    from .. import ops
    ops.current_match.set(match_id)
    started = time.perf_counter()
    fs = insight_sheet(store.analyzer(match_id), insight)
    trace: list[dict] = [{"agent": "Detector", "action": f"change point at {insight['start_minute']}' (confidence {insight['confidence']})", "ms": 0}]
    task = "Explain the DETECTED CHANGE in one or two sentences for the studio, with the numbers. Cite facts."
    text, engine = "", "offline"
    if agents.mode() != "offline":
        try:
            text = await _generate(fs, task, persona, language, trace)
            engine = "azure"
        except Exception as exc:
            trace.append({"agent": "Analyst", "action": f"fallback to structured sentence ({type(exc).__name__})", "ms": 0})
            text = ""
    if not text:
        engine = "offline"
        text = insight["text"]
        trace.append({"agent": "Analyst (offline engine)", "action": "sentence written from the structured insight", "ms": 0})
        if language != "en" and settings.translator:
            try:
                text = (await translate([text], language))[0]
                trace.append({"agent": "Localizer", "action": f"Azure Translator -> {language}", "ms": 0})
            except Exception:
                pass
    draft, planted = text, None
    if drill:
        planted = plant_error(text, fs, random.Random(insight["id"]))
        if planted:
            draft = planted["text"]
            trace.append({"agent": "Verifier drill", "action": f"planted an overstated number in the draft ({planted['original']} -> {planted['planted']})", "ms": 0})
    report = check(draft, fs)
    trace.append({"agent": "Verifier", "action": f"re-checked {report['checked_claims']} claims", "ms": 1})
    verification = None
    if report["issues"] or planted:
        caught = bool(planted) and any(i["problem"] == planted["problem"] for i in report["issues"])
        verification = {"drill": bool(planted), "draft": draft, "issues": report["issues"][:5], "caught": caught if planted else None,
                        "planted": {k: planted[k] for k in ("original", "planted")} if planted else None}
    if report["issues"]:
        problems = "; ".join(i["problem"] for i in report["issues"][:5])
        trace.append({"agent": "Verifier", "action": f"sent back to the Analyst: {problems}"[:200], "ms": 1})
        if engine == "azure":
            try:
                text = await _generate(fs, f"{task}\nYour draft failed verification ({problems}). Rewrite using only the facts.", persona, language, trace)
            except Exception as exc:
                trace.append({"agent": "Analyst", "action": f"rewrite failed, structured sentence ({type(exc).__name__})", "ms": 0})
                text = insight["text"]
        elif planted:
            trace.append({"agent": "Analyst (offline engine)", "action": "rewrote from the structured insight", "ms": 0})
    elif planted:
        trace.append({"agent": "Verifier", "action": "missed the planted error; the clean draft airs instead", "ms": 0})
    report = check(text, fs)
    if report["issues"]:
        text = strip_unsupported(text, report) or insight["text"]
        report = check(text, fs)
    result = {"id": f"nar-{cache_key}", "match_id": match_id, "scope": "insight", "insight_id": insight["id"], "persona": persona,
              "language": language, "text": text, "citations": citations_used(text, fs), "fact_check": report, "engine": engine,
              "verification": verification, "latency_ms": int((time.perf_counter() - started) * 1000), "agent_trace": trace}
    _cache[cache_key] = result
    ops.record_latency(result["latency_ms"])
    return result
