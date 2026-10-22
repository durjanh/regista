"""Platform status: health (which Azure services are connected) and the ops report (SLOs, cost)."""

from __future__ import annotations

from fastapi import APIRouter

from ... import ops
from ...ai import agents
from ...analytics.scouting import scouting
from ...brand_safe import ENABLED as video_safe
from ...config import VERSION, settings
from ...integrations import persistence
from ...live import broadcast
from ...live.replay import latency_stats

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health")
async def health():
    p = persistence.status()
    return {"status": "ok", "mode": settings.mode, "version": VERSION, "agents_runtime": agents.mode(), "scouting_ready": scouting.ready,
            "video_safe": video_safe,
            "services": {"llm": settings.llm, "agents": settings.agents, "speech": settings.speech, "translator": settings.translator,
                         "safety": settings.safety, "cosmos": p["cosmos"], "eventhub": bool(settings.eventhub_fqdn), "onelake": p["onelake"],
                         "webpubsub": broadcast.enabled()},
            "live": {"source": settings.live_source, "narrative_latency": latency_stats()}}


@router.get("/ops")
async def ops_report():
    return ops.report(settings.mode)
