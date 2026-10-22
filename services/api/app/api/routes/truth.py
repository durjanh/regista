"""The truth loop: detector insights, Verifier-checked insight lines, the graded truth report, counterfactuals, score."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException

from ...ai import narrator
from ...services.truth import counterfactual_run, truth_report, truth_score
from ...store import MatchStore
from ..deps import get_store, require_match
from ..schemas import CounterfactualRequest, InsightNarrateRequest

router = APIRouter(prefix="/api", tags=["truth"])


@router.get("/matches/{match_id}/insights")
async def match_insights(upto_t: float | None = None, match_id: str = Depends(require_match), store: MatchStore = Depends(get_store)):
    return await asyncio.to_thread(store.analyzer(match_id).insights, upto_t)


@router.post("/matches/{match_id}/insights/{insight_id}/narrate")
async def match_insight_narrate(insight_id: str, req: InsightNarrateRequest, match_id: str = Depends(require_match),
                                store: MatchStore = Depends(get_store)):
    """Analyst line for one detected change, checked by the Verifier. drill=true plants one overstated number first."""
    insights = await asyncio.to_thread(store.analyzer(match_id).insights)
    ins = next((i for i in insights if i["id"] == insight_id), None)
    if not ins:
        raise HTTPException(404, f"Unknown insight {insight_id}")
    return await narrator.narrate_insight(match_id, ins, req.persona, req.language, drill=req.drill)


@router.get("/matches/{match_id}/truth")
async def match_truth(upto_t: float | None = None, match_id: str = Depends(require_match), store: MatchStore = Depends(get_store)):
    """Truth mode: reveal what the generator planted and grade what the agents detected so far."""
    return await truth_report(store.analyzer(match_id), match_id, upto_t)


@router.post("/matches/{match_id}/counterfactual")
async def match_counterfactual(req: CounterfactualRequest, match_id: str = Depends(require_match), store: MatchStore = Depends(get_store)):
    try:
        return await counterfactual_run(store.get(match_id), match_id, req.plant_id, req.runs)
    except KeyError:
        raise HTTPException(404, f"Unknown plant {req.plant_id}") from None


@router.get("/truth/score")
async def truth_score_endpoint():
    """Latest truth-suite result (CI artifact or local run) plus the per-commit history."""
    return truth_score()
