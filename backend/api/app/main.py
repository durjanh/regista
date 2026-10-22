"""Regista API: explainable match intelligence, live narratives and automated recaps.

Composition root: start-up and shutdown (lifespan), middleware, one router per domain (app/api/routes) and the MCP
server. Routes live in app/api, use cases in app/services, the domain in app/analytics, app/ai, app/forge, app/live.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .ai import agents
from .api.routes import ROUTERS
from .brand_safe import VideoSafeMiddleware
from .config import VERSION, settings
from .forge.reference import reference
from .integrations import telemetry
from .integrations.http import http_client
from .live import broadcast
from .mcp_server import mcp
from .services.forge import calibration_report, restore_generated_matches
from .store import store

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("regista")


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    telemetry.configure()
    await asyncio.to_thread(reference)
    await asyncio.to_thread(store.load)
    try:  # what-ifs generated before the last restart (bounded: Storage must never hold up start-up)
        restored = await asyncio.wait_for(restore_generated_matches(store), timeout=20)
        if restored:
            log.info("Restored %d generated matches from Blob", restored)
    except TimeoutError:
        log.warning("Restoring generated matches timed out; they reappear on the next start")
    consumer = None
    if settings.live_source == "eventhub" and settings.eventhub_fqdn:
        from .live.eventhub import consume_forever
        consumer = asyncio.create_task(consume_forever())
    warm = asyncio.create_task(calibration_report(n=100))                       # precompute the calibration report
    scout_warm = asyncio.create_task(asyncio.to_thread(store.ensure_scouting))  # scouting corpus + index
    log.info("Regista ready: %d matches, mode=%s, agents=%s", len(store.docs), settings.mode, agents.mode())
    async with mcp.session_manager.run():
        yield
    warm.cancel()
    scout_warm.cancel()
    await broadcast.shutdown()
    await http_client().aclose()
    if consumer:
        consumer.cancel()


def create_app() -> FastAPI:
    app = FastAPI(title="Regista API", version=VERSION, lifespan=lifespan,
                  description="Explainable football match intelligence: real results rebuilt as synthetic event data, "
                              "multi-agent narratives, live studio graphics and automated recaps.")
    app.add_middleware(VideoSafeMiddleware)
    app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
                       allow_methods=["*"], allow_headers=["*"])
    for router in ROUTERS:
        app.include_router(router)
    # MCP server last, so it only receives paths the API did not match.
    app.mount("/", mcp.streamable_http_app())
    return app


app = create_app()
