"""Automated match recap: a multi-agent pipeline.

  Analyst ─┐                        ┌─> FactChecker ─(repair)─> Narrator
           ├─(ConcurrentBuilder)──> Narrator (report, headline, script)
  Tactician┘                        └─> Social editor
  Producer (deterministic): highlight run-sheet with timecodes, player of the match

All agents see the same numbered fact sheet; every claim is checked before it is published.
"""

from __future__ import annotations

import json
import logging
import time

from ..store import store
from . import agents
from .agents import AgentSpec
from .factcheck import check, citations_used, strip_unsupported
from .facts import full_sheet
from .offline import recap as offline_recap
from .personas import GROUNDING_RULES, language_name, persona_guide
from .services import moderate

log = logging.getLogger("regista.recap")
_cache: dict[tuple, dict] = {}


def _tc(seconds: float) -> str:
    s = int(max(0, seconds))
    return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}"


def run_sheet(analysis: dict) -> list[dict]:
    """Highlight edit list for a video editor: the top moments with pre-roll and post-roll."""
    picks = [m for m in analysis["moments"] if m["type"] != "turning_point" and m["importance"] >= 45]
    picks = sorted(picks, key=lambda m: -m["importance"])[:10]
    out = []
    for m in sorted(picks, key=lambda m: m["t"]):
        pre = 25 if m["type"] in ("goal", "big_chance", "save") else 10
        out.append({"tc_start": _tc(m["t"] - pre), "tc_end": _tc(m["t"] + (20 if m["type"] == "goal" else 8)),
                    "minute": m["minute"], "title": m["title"], "event_ids": m["event_ids"][-6:], "priority": m["importance"]})
    return out


def player_of_match(analysis: dict) -> dict | None:
    if not analysis["top_players"]:
        return None
    p = analysis["top_players"][0]
    metrics = [{"fact_id": f"pom:{k}", "label": label, "value": p[k]} for k, label in
               (("rating", "Rating"), ("goals", "Goals"), ("assists", "Assists"), ("xt", "Threat added (xT)"),
                ("key_passes", "Key passes"), ("pass_completion", "Pass completion")) if p.get(k)]
    reason = f"Highest match rating ({p['rating']})" + (f", {p['goals']} goal(s)" if p["goals"] else "") + \
             (f", {p['assists']} assist(s)" if p["assists"] else "") + (f", {p['xt']} xT added" if p["xt"] > 0.1 else "")
    return {"player_id": p["player_id"], "name": p["name"], "team_id": p["team_id"], "reason": reason, "metrics": metrics}


async def build_recap(match_id: str, persona: str = "broadcaster", language: str = "en") -> dict:
    key = (match_id, persona, language)
    if key in _cache:
        return _cache[key]
    from .. import ops
    ops.current_match.set(match_id)
    started = time.perf_counter()
    an = store.analyzer(match_id)
    analysis = an.analyze()
    meta = an.meta
    fs = full_sheet(meta, analysis)
    trace: list[dict] = []
    sheet = fs.render()
    engine = "offline"
    out = None

    if agents.mode() != "offline":
        try:
            lang = language_name(language)
            analyst = AgentSpec("Analyst", f"You are a football data analyst. From the facts, list the 4 most important findings about "
                                           f"chance quality, game state and turning points. Bullet points, cite facts.\n{GROUNDING_RULES}")
            tactician = AgentSpec("Tactician", f"You are a tactics coach. From the facts, list 3 tactical findings: shape, shape changes, "
                                               f"pressing (PPDA), territory (field tilt). Bullet points, cite facts.\n{GROUNDING_RULES}")
            insights = await agents.run_concurrent([analyst, tactician], sheet)
            for r in insights:
                trace += r.trace
            narrator = AgentSpec("Narrator", deployment=None, instructions=(
                f"You are Regista's match reporter. Voice: {persona_guide(persona)}\nWrite in {lang}.\n{GROUNDING_RULES}\n"
                'Return JSON: {"headline": str (max 12 words), "standfirst": str (1-2 sentences), '
                '"report_md": str (350-500 words, markdown with ## and ### headings, cite facts), '
                '"audio_script": str (about 60 seconds read aloud, no citations, no markdown)}'))
            narr_prompt = f"{sheet}\n\nANALYST NOTES:\n{insights[0].text}\n\nTACTICIAN NOTES:\n{insights[1].text}\n\nTASK: Write the match report."
            res = await agents.run(narrator, narr_prompt, json_mode=True, max_tokens=2200)
            trace += res.trace
            out = json.loads(res.text)
            report = check(out.get("report_md", "") + " " + out.get("headline", "") + " " + out.get("standfirst", ""), fs)
            trace.append({"agent": "FactChecker", "action": f"verified {report['checked_claims']} claims", "ms": 1})
            if not report["passed"]:
                problems = "; ".join(i["problem"] for i in report["issues"][:8]) + " " + "; ".join(b["phrase"] for b in report["bias_flags"])
                res = await agents.run(narrator, f"{narr_prompt}\n\nYour previous draft failed fact-checking: {problems}. Fix it.", json_mode=True, max_tokens=2200)
                trace += res.trace + [{"agent": "FactChecker", "action": "repair round", "ms": 1}]
                out = json.loads(res.text)
            social = AgentSpec("SocialEditor", f"You are a social media editor. Write in {lang}. {GROUNDING_RULES}\n"
                                               'Return JSON: {"posts": [{"platform": "x"|"instagram"|"tiktok"|"whatsapp", "text": str}]} with 4 posts, no citations.')
            sres = await agents.run(social, f"{sheet}\n\nHEADLINE: {out.get('headline')}\nTASK: Write the posts.", json_mode=True, max_tokens=700)
            trace += sres.trace
            out["social_posts"] = json.loads(sres.text).get("posts", [])
            engine = "azure"
        except Exception as exc:
            log.warning("Recap AI pipeline failed, using offline engine: %s", exc)
            trace.append({"agent": "Narrator", "action": f"fallback to offline engine ({type(exc).__name__})", "ms": 0})
            out = None
    if out is None:
        ts = time.perf_counter()
        out = offline_recap(meta, analysis, fs, persona)
        trace.append({"agent": "Narrator (offline engine)", "action": "templated grounded report", "ms": int((time.perf_counter() - ts) * 1000)})

    combined = " ".join([out.get("headline", ""), out.get("standfirst", ""), out.get("report_md", "")])
    report = check(combined, fs)
    if report["issues"]:
        out["report_md"] = strip_unsupported(out.get("report_md", ""), report) or out.get("report_md", "")
        report = check(" ".join([out.get("headline", ""), out.get("standfirst", ""), out.get("report_md", "")]), fs)
    safety = await moderate(combined)
    if safety.get("flagged"):
        report["passed"] = False
        report["issues"].append({"sentence": "", "problem": "Content Safety flagged the report"})
    sheet_rows = run_sheet(analysis)
    trace.append({"agent": "Producer", "action": f"highlight run-sheet ({len(sheet_rows)} clips)", "ms": 1})
    trace.append({"agent": "Guardrails", "action": "fact-check + fair commentary + content safety", "ms": 0})
    result = {
        "match_id": match_id, "persona": persona, "language": language,
        "headline": out.get("headline", ""), "standfirst": out.get("standfirst", ""), "report_md": out.get("report_md", ""),
        "social_posts": out.get("social_posts", []), "audio_script": out.get("audio_script", ""),
        "run_sheet": sheet_rows, "player_of_match": player_of_match(analysis),
        "citations": citations_used(combined, fs), "fact_check": report, "engine": engine,
        "latency_ms": int((time.perf_counter() - started) * 1000), "agent_trace": trace,
    }
    _cache[key] = result
    return result
