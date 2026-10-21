"""Regista API: explainable match intelligence, live narratives and automated recaps."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from functools import lru_cache

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from .ai import agents, producer
from .ai.ask import ask as ask_agent
from .ai.director import direct
from .ai.narrator import narrate
from .ai.recap import build_recap
from .ai.services import synthesize, translate
from .analytics.stats import player_stats, possession_chain
from .analytics.xg import shot_xg
from .brand_safe import VideoSafeMiddleware
from .config import VERSION, settings
from .forge.calibration import run_calibration
from .forge.matches import MatchBuildError, build_what_if
from .forge.reference import reference
from .integrations import persistence, telemetry
from .live.replay import latency_stats, live_stream, overlay_stream
from .mcp_server import mcp
from .store import store

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("regista")


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    telemetry.configure()
    await asyncio.to_thread(reference)
    await asyncio.to_thread(store.load)
    consumer = None
    if settings.live_source == "eventhub" and settings.eventhub_fqdn:
        from .live.eventhub import consume_forever
        consumer = asyncio.create_task(consume_forever())
    warm = asyncio.create_task(forge_calibration(n=100))          # precompute the calibration report
    scout_warm = asyncio.create_task(asyncio.to_thread(store.ensure_scouting))   # scouting corpus + index
    log.info("Regista ready: %d matches, mode=%s, agents=%s", len(store.docs), settings.mode, agents.mode())
    async with mcp.session_manager.run():
        yield
    warm.cancel()
    scout_warm.cancel()
    if consumer:
        consumer.cancel()


app = FastAPI(title="Regista API", version=VERSION, lifespan=lifespan,
              description="Explainable football match intelligence: real results rebuilt as synthetic event data, "
                          "multi-agent narratives, live studio graphics and automated recaps.")
app.add_middleware(VideoSafeMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
                   allow_methods=["*"], allow_headers=["*"])


def _match(match_id: str) -> None:
    if match_id not in store.docs:
        raise HTTPException(404, f"Unknown match {match_id}") from None


# ---------------------------------------------------------------- health & reference data

@app.get("/api/health")
async def health():
    p = persistence.status()
    from .analytics.scouting import scouting
    from .brand_safe import ENABLED as video_safe
    return {"status": "ok", "mode": settings.mode, "version": VERSION, "agents_runtime": agents.mode(), "scouting_ready": scouting.ready,
            "video_safe": video_safe,
            "services": {"llm": settings.llm, "agents": settings.agents, "speech": settings.speech, "translator": settings.translator,
                         "safety": settings.safety, "cosmos": p["cosmos"], "eventhub": bool(settings.eventhub_fqdn), "onelake": p["onelake"]},
            "live": {"source": settings.live_source, "narrative_latency": latency_stats()}}


@app.get("/api/reference/summary")
async def reference_summary():
    return reference().summary()


@app.get("/api/reference/teams")
async def reference_teams(limit: int = Query(120, ge=1, le=400)):
    return reference().ranking(limit=limit)


@app.get("/api/reference/teams/{team_id}")
async def reference_team(team_id: str):
    try:
        return await asyncio.to_thread(reference().team_detail, team_id)
    except KeyError:
        raise HTTPException(404, f"Unknown team {team_id}") from None


@app.get("/api/reference/h2h")
async def reference_h2h(a: str, b: str, before: str | None = None):
    ref = reference()
    try:
        return ref.h2h(ref.name_of(a), ref.name_of(b), before)
    except KeyError as exc:
        raise HTTPException(404, f"Unknown team {exc}") from None


# ---------------------------------------------------------------- matches & analytics

@app.get("/api/matches")
async def matches():
    return store.summaries()


@app.get("/api/matches/{match_id}")
async def match(match_id: str):
    _match(match_id)
    meta = dict(store.get(match_id)["meta"])
    meta.pop("truth", None)
    return meta


@app.get("/api/matches/{match_id}/events")
async def events(match_id: str, from_t: float = 0, to_t: float = 1e9, types: str | None = None):
    _match(match_id)
    allowed = set(types.split(",")) if types else None
    return [e for e in store.get(match_id)["events"] if from_t <= e["t"] <= to_t and (allowed is None or e["type"] in allowed)]


@app.get("/api/matches/{match_id}/analysis")
async def analysis(match_id: str, upto_t: float | None = None):
    _match(match_id)
    return await asyncio.to_thread(store.analyzer(match_id).analyze, upto_t)


@app.get("/api/matches/{match_id}/moments/{moment_id}")
async def moment(match_id: str, moment_id: str):
    _match(match_id)
    an = store.analyzer(match_id)
    m = next((m for m in an.analyze()["moments"] if m["id"] == moment_id), None)
    if not m:
        raise HTTPException(404, f"Unknown moment {moment_id}") from None
    by_id = {e["id"]: e for e in an.events}
    shot = next((by_id[eid] for eid in reversed(m["event_ids"]) if eid in by_id and by_id[eid]["type"] == "shot"), None)
    anchor = shot or (by_id.get(m["event_ids"][-1]) if m["event_ids"] else None)
    sequence = possession_chain(an.events, anchor["id"]) if anchor else []
    breakdown = None
    if shot:
        assist = by_id.get(shot.get("assist_event_id")) if shot.get("assist_event_id") else None
        breakdown = {"event_id": shot["id"], **shot_xg(shot, assist.get("pass_type") if assist else None)}
        breakdown["xg"] = shot.get("xg", breakdown["xg"])
    return {"moment": m, "sequence": sequence, "freeze_frame": shot.get("freeze_frame") if shot else None, "xg_breakdown": breakdown}


@app.get("/api/matches/{match_id}/players")
async def players(match_id: str, upto_t: float | None = None):
    _match(match_id)
    an = store.analyzer(match_id)
    return player_stats(an.events_upto(upto_t), an.meta, upto_t)


@app.get("/api/matches/{match_id}/live")
async def live(match_id: str, speed: float = 30, start_t: float = 0, persona: str = "casual", language: str = "en", drill: bool = False):
    """drill=true runs the Verifier drill on insight lines: one overstated number is planted in each draft."""
    _match(match_id)
    return EventSourceResponse(live_stream(match_id, speed, start_t, persona, language, drill), ping=15,
                               headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------- AI: narratives, recaps, Q&A, speech, translation

class NarrateRequest(BaseModel):
    match_id: str
    scope: str = Field("moment", pattern="^(moment|live_line|halftime|fulltime)$")
    moment_id: str | None = None
    persona: str = "casual"
    language: str = "en"
    upto_t: float | None = None


@app.post("/api/narrate")
async def narrate_endpoint(req: NarrateRequest):
    _match(req.match_id)
    try:
        result = await narrate(req.match_id, req.scope, req.persona, req.language, req.moment_id, req.upto_t)
    except KeyError as exc:
        raise HTTPException(404, f"Unknown moment {exc}") from None
    persistence.save("narratives", result)
    return result


class RecapRequest(BaseModel):
    match_id: str
    persona: str = "broadcaster"
    language: str = "en"


@app.post("/api/recap")
async def recap_endpoint(req: RecapRequest):
    _match(req.match_id)
    result = await build_recap(req.match_id, req.persona, req.language)
    persistence.save("recaps", {"id": f"{req.match_id}-{req.persona}-{req.language}", **result})
    return result


class AskRequest(BaseModel):
    match_id: str
    question: str = Field(..., min_length=2, max_length=600)
    persona: str = "casual"
    language: str = "en"
    upto_t: float | None = None
    history: list[dict] | None = None


@app.post("/api/ask")
async def ask_endpoint(req: AskRequest):
    _match(req.match_id)
    return await ask_agent(req.match_id, req.question, req.persona, req.language, req.upto_t, req.history)


class SpeechRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    language: str = "en"
    persona: str | None = None


@lru_cache(maxsize=256)
def _audio_key(text: str, language: str, persona: str | None) -> str:
    import hashlib
    return hashlib.sha1(f"{language}|{persona}|{text}".encode()).hexdigest()[:20]


_audio_cache: dict[str, bytes] = {}


@app.post("/api/speech")
async def speech(req: SpeechRequest):
    if not settings.speech:
        raise HTTPException(501, "Speech is not configured; use the browser speech synthesis fallback")
    key = _audio_key(req.text, req.language, req.persona)
    if key not in _audio_cache:
        try:
            _audio_cache[key] = await synthesize(req.text, req.language, req.persona)
        except Exception as exc:
            log.warning("Speech synthesis failed: %s", exc)
            raise HTTPException(502, "Speech synthesis failed") from None
        persistence.save_blob("audio", f"{key}.mp3", _audio_cache[key], "audio/mpeg")
    return Response(_audio_cache[key], media_type="audio/mpeg")


class TranslateRequest(BaseModel):
    texts: list[str]
    to: str


@app.post("/api/translate")
async def translate_endpoint(req: TranslateRequest):
    if not settings.translator or req.to == "en":
        return {"texts": req.texts, "engine": "offline"}
    try:
        return {"texts": await translate(req.texts, req.to), "engine": "azure"}
    except Exception as exc:
        log.warning("Translation failed: %s", exc)
        return {"texts": req.texts, "engine": "offline"}


# ---------------------------------------------------------------- studio (producer console + broadcast overlay)

@app.get("/api/studio/{match_id}/queue")
async def studio_queue(match_id: str, upto_t: float | None = None):
    _match(match_id)
    return await asyncio.to_thread(producer.propose, match_id, upto_t)


class StudioAction(BaseModel):
    action: str = Field(..., pattern="^(approve|reject|on_air|edit|kill)$")
    title: str | None = None
    body: str | None = None


class StudioNewItem(BaseModel):
    kind: str = Field(..., pattern="^(lower_third|stat_card|talking_point|replay_cue|score_bug_alert)$")
    title: str = Field(..., min_length=1, max_length=120)
    body: str = Field("", max_length=400)
    priority: int = Field(60, ge=0, le=100)
    duration_s: int = Field(10, ge=3, le=30)
    t: float | None = None
    template: str | None = Field(None, max_length=40)
    data: dict = Field(default_factory=dict)
    key: str | None = Field(None, pattern="^[a-z0-9-]{1,40}$")


@app.post("/api/studio/{match_id}/items")
async def studio_add(match_id: str, req: StudioNewItem):
    """Producer-authored graphic (e.g. from the half-time pack). Enters the queue as `proposed`, like agent proposals."""
    _match(match_id)
    item = producer.add_item(match_id, req.model_dump())
    persistence.save("studio", item)
    return item


@app.post("/api/studio/{match_id}/items/{item_id}")
async def studio_action(match_id: str, item_id: str, req: StudioAction):
    _match(match_id)
    try:
        item = producer.act(match_id, item_id, req.action, req.title, req.body)
        if req.action in ("approve", "edit") and len(item.get("cue", {}).get("languages", [])) > 1:
            await producer.translate_cue(item)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None
    except KeyError:
        raise HTTPException(404, f"Unknown studio item {item_id}") from None
    persistence.save("studio", item)
    return item


@app.get("/api/studio/{match_id}/overlay")
async def studio_overlay(match_id: str):
    _match(match_id)
    return EventSourceResponse(overlay_stream(match_id), ping=15, headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/studio/profiles")
async def studio_profiles():
    return producer.PROFILES


class StudioSettings(BaseModel):
    profile_id: str | None = None
    auto_approve_threshold: float | None = None
    clear_threshold: bool = False


@app.get("/api/studio/{match_id}/settings")
async def studio_get_settings(match_id: str):
    _match(match_id)
    return producer.settings_for(match_id)


@app.post("/api/studio/{match_id}/settings")
async def studio_set_settings(match_id: str, req: StudioSettings):
    _match(match_id)
    try:
        return producer.update_settings(match_id, req.profile_id, req.auto_approve_threshold, req.clear_threshold)
    except KeyError:
        raise HTTPException(404, f"Unknown profile {req.profile_id}") from None


@app.get("/api/studio/{match_id}/audit")
async def studio_audit(match_id: str):
    _match(match_id)
    return producer.audit_log(match_id)


# ---------------------------------------------------------------- truth loop: insights, grader, counterfactuals

@app.get("/api/matches/{match_id}/insights")
async def match_insights(match_id: str, upto_t: float | None = None):
    _match(match_id)
    return await asyncio.to_thread(store.analyzer(match_id).insights, upto_t)


class InsightNarrateRequest(BaseModel):
    persona: str = "analyst"
    language: str = "en"
    drill: bool = False


@app.post("/api/matches/{match_id}/insights/{insight_id}/narrate")
async def match_insight_narrate(match_id: str, insight_id: str, req: InsightNarrateRequest):
    """Analyst line for one detected change, checked by the Verifier. drill=true plants one overstated number first."""
    _match(match_id)
    from .ai.narrator import narrate_insight
    insights = await asyncio.to_thread(store.analyzer(match_id).insights)
    ins = next((i for i in insights if i["id"] == insight_id), None)
    if not ins:
        raise HTTPException(404, f"Unknown insight {insight_id}")
    return await narrate_insight(match_id, ins, req.persona, req.language, drill=req.drill)


@app.get("/api/matches/{match_id}/truth")
async def match_truth(match_id: str, upto_t: float | None = None):
    """Truth mode: reveal what the generator planted and grade what the agents detected so far."""
    _match(match_id)
    from .analytics.engine import minute_of
    from .analytics.grader import grade
    an = store.analyzer(match_id)
    t = an.end_t if upto_t is None else min(upto_t, an.end_t)
    insights = await asyncio.to_thread(an.insights, t)
    insights = [i for i in insights if i["detected_t"] <= t]
    truth = an.meta.get("truth") or {}
    plants = truth.get("plants", [])
    g = grade(plants, insights, truth.get("labels", []), upto_minute=minute_of(t, an.meta), events=an.events)
    return {"match_id": match_id, "upto_t": t, "plants": plants, "insights": insights, "grades": g["grades"],
            "false_alarms": g["false_alarms"], "natural": g["natural"], "score": g["score"]}


class CounterfactualRequest(BaseModel):
    plant_id: str
    runs: int = Field(16, ge=4, le=40)


_cf_cache: dict[tuple, dict] = {}


@app.post("/api/matches/{match_id}/counterfactual")
async def match_counterfactual(match_id: str, req: CounterfactualRequest):
    _match(match_id)
    from .analytics import counterfactual
    key = (match_id, req.plant_id, req.runs)
    if key not in _cf_cache:
        try:
            _cf_cache[key] = await asyncio.to_thread(counterfactual.run, store.get(match_id), req.plant_id, req.runs)
        except KeyError:
            raise HTTPException(404, f"Unknown plant {req.plant_id}") from None
    return _cf_cache[key]


@app.get("/api/truth/score")
async def truth_score():
    """Latest truth-suite result (CI artifact or local run) plus the per-commit history."""
    import json

    from .forge.reference import REPO_ROOT
    latest_path = REPO_ROOT / "data" / "reference" / "truth-latest.json"
    hist_path = REPO_ROOT / "data" / "reference" / "truth-score-history.json"
    latest = json.loads(latest_path.read_text()) if latest_path.exists() else None
    history = json.loads(hist_path.read_text()) if hist_path.exists() else []
    return {"latest": latest, "history": history}


@app.get("/api/ops")
async def ops_report():
    from . import ops
    return ops.report(settings.mode)


# ---------------------------------------------------------------- manager & scouting

@app.get("/api/scouting/players")
async def scouting_players(team_id: str | None = None, q: str | None = None):
    sc = await asyncio.to_thread(store.ensure_scouting)
    return sc.search(team_id, q)


@app.get("/api/scouting/players/{player_key}")
async def scouting_player(player_key: str):
    sc = await asyncio.to_thread(store.ensure_scouting)
    try:
        return await asyncio.to_thread(sc.player_dna, player_key)
    except KeyError:
        raise HTTPException(404, f"No scouting profile for {player_key}") from None


@app.get("/api/scouting/teams/{team_id}")
async def scouting_team(team_id: str):
    sc = await asyncio.to_thread(store.ensure_scouting)
    try:
        return await asyncio.to_thread(sc.team_report, team_id)
    except KeyError:
        raise HTTPException(404, f"Unknown team {team_id}") from None


@app.get("/api/matches/{match_id}/dugout")
async def match_dugout(match_id: str, side: str = Query("home", pattern="^(home|away)$"), upto_t: float | None = None):
    _match(match_id)
    sc = await asyncio.to_thread(store.ensure_scouting)
    from .analytics.dugout import dugout
    return await asyncio.to_thread(dugout, store.analyzer(match_id), store.get(match_id), side, upto_t, sc)


class BriefRequest(BaseModel):
    match_id: str
    side: str = Field("home", pattern="^(home|away)$")
    upto_t: float | None = None
    language: str = "en"


@app.post("/api/dugout/brief")
async def dugout_brief(req: BriefRequest):
    _match(req.match_id)
    from .ai.coach import brief
    return await brief(req.match_id, req.side, req.upto_t, req.language)


@app.get("/api/matches/{match_id}/physical")
async def match_physical(match_id: str, upto_t: float | None = None):
    _match(match_id)
    from .forge import physical
    doc = store.get(match_id)
    an = store.analyzer(match_id)
    t = an.end_t if upto_t is None else min(upto_t, an.end_t)
    phys = physical.upto(doc.get("physical") or physical.compute(doc), doc["meta"], t, an.end_t)
    roster = {p["player_id"]: p for s in ("home", "away") for p in doc["meta"][s]["players"]}
    rows = [{"player_id": pid, "player_key": roster[pid].get("player_key"), "name": roster[pid]["name"], "team_id": roster[pid]["team_id"],
             "position": roster[pid]["position"], "minutes": v["minutes"], "distance_km": v["distance_km"], "sprints": v["sprints"],
             "top_speed_kmh": v["top_speed_kmh"], "by_15": v["by_15"]} for pid, v in phys.items() if pid in roster]
    rows.sort(key=lambda r: -r["distance_km"])
    return {"players": rows}


# ---------------------------------------------------------------- Data Forge

@app.get("/api/forge/teams")
async def forge_teams(limit: int = Query(48, ge=2, le=120)):
    ref = reference()

    def build():
        out = []
        for t in ref.ranking(limit=limit):
            # profiled against an equal opponent, so the listed archetype is the team's neutral default
            profile = ref.team_profile(t["name"], ref.latest_date(), t["name"], home=True, neutral=True)
            out.append({**profile.payload(), "rank": t["rank"]})
        return out
    return await asyncio.to_thread(build)


class ScenarioRequest(BaseModel):
    prompt: str = Field(..., min_length=3, max_length=500)


@app.post("/api/forge/scenario")
async def forge_scenario(req: ScenarioRequest):
    return await direct(req.prompt)


class ForgeConfig(BaseModel):
    home_team_id: str
    away_team_id: str
    seed: int | None = None
    scenario: str = "balanced"
    intensity: float = 0.5
    home_formation: str | None = None
    away_formation: str | None = None
    as_of: str | None = None


@app.post("/api/forge/generate")
async def forge_generate(cfg: ForgeConfig):
    ref = reference()
    if cfg.home_team_id not in ref.names or cfg.away_team_id not in ref.names:
        raise HTTPException(400, "Unknown team id") from None
    try:
        doc = await asyncio.to_thread(build_what_if, cfg.home_team_id, cfg.away_team_id, cfg.as_of, cfg.scenario,
                                      cfg.intensity, cfg.seed, True, cfg.home_formation, cfg.away_formation)
    except (MatchBuildError, KeyError, ValueError) as exc:
        raise HTTPException(400, str(exc)) from None
    store.add_generated(doc)
    persistence.export_dataset(doc)
    persistence.save("matches", {"id": doc["meta"]["match_id"], "match_id": doc["meta"]["match_id"],
                                 **{k: v for k, v in doc["meta"].items() if k not in ("home", "away")}})
    summary = next(s for s in store.summaries() if s["match_id"] == doc["meta"]["match_id"])
    return {"match": summary, "calibration": await forge_calibration(n=100)}


_calibration_cache: dict[int, dict] = {}


@app.get("/api/forge/calibration")
async def forge_calibration(n: int = Query(100, ge=6, le=200)):
    if n not in _calibration_cache:
        _calibration_cache[n] = await asyncio.to_thread(run_calibration, n)
    return _calibration_cache[n]


# MCP server last, so it only receives paths the API did not match.
app.mount("/", mcp.streamable_http_app())
