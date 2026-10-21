"""Live match stream (Server-Sent Events).

Two sources, same output:
- replay (default): events are replayed from the match document at `speed` x real time.
- eventhub: events arrive from Azure Event Hubs (published by the feeder job) and are streamed as they land.

As events flow, the live engine updates the analysis, detects moments, asks the Narrator for each moment in the
viewer's persona and language, and asks the Producer for broadcast graphics. Narratives are generated off the hot
path, so a slow model never delays the event feed.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import defaultdict

from ..ai import producer
from ..ai.narrator import narrate, narrate_insight
from ..brand_safe import ENABLED as VIDEO_SAFE
from ..brand_safe import scrub
from ..config import settings
from ..store import store

log = logging.getLogger("regista.live")
TRIGGER_TYPES = {"shot", "card", "substitution", "foul"}
latency_samples: list[int] = []


class LiveHub:
    """Event buffers fed by the Event Hubs consumer, with waiters for SSE streams."""

    def __init__(self) -> None:
        self.events: dict[str, list[dict]] = defaultdict(list)
        self.signals: dict[str, asyncio.Event] = defaultdict(asyncio.Event)

    def push(self, event: dict) -> None:
        mid = event.get("match_id")
        if not mid:
            return
        if event.get("seq") == 1:
            self.events[mid] = []
        self.events[mid].append(event)
        self.signals[mid].set()

    async def wait(self, match_id: str, timeout: float = 15.0) -> None:
        sig = self.signals[match_id]
        try:
            await asyncio.wait_for(sig.wait(), timeout)
        except TimeoutError:
            pass
        sig.clear()


hub = LiveHub()


def _sse(event: str, data) -> dict:
    text = json.dumps(data, default=str)
    return {"event": event, "data": scrub(text) if VIDEO_SAFE else text}   # SSE bypasses the JSON middleware


async def live_stream(match_id: str, speed: float = 30.0, start_t: float = 0.0, persona: str = "casual", language: str = "en",
                      drill: bool = False):
    an = store.analyzer(match_id)
    speed = max(1.0, min(speed, 600.0))
    queue: asyncio.Queue = asyncio.Queue()
    sent_moments: set[str] = set()
    tasks: set[asyncio.Task] = set()

    async def narrate_moment(m: dict, t: float) -> None:
        started = time.perf_counter()
        try:
            narrative = await narrate(match_id, "moment", persona, language, moment_id=m["id"], upto_t=t)
            latency_samples.append(int((time.perf_counter() - started) * 1000))
            del latency_samples[:-200]
            await queue.put(_sse("moment", {**m, "narrative": narrative}))
        except Exception as exc:
            log.warning("Narrative failed for %s: %s", m["id"], exc)

    sent_insights: set[str] = set()

    async def narrate_ins(ins: dict) -> None:
        try:
            narrative = await narrate_insight(match_id, ins, "analyst" if persona in ("casual", "kids") else persona, language, drill=drill)
            await queue.put(_sse("insight", {**ins, "narrative": narrative}))
        except Exception as exc:
            log.warning("Insight narrative failed for %s: %s", ins["id"], exc)

    def check_insights(t: float) -> None:
        for ins in an.insights(t):
            if ins["id"] in sent_insights or ins["detected_t"] > t:
                continue
            sent_insights.add(ins["id"])
            queue.put_nowait(_sse("insight", ins))
            for item in producer.proposals_for_insight(match_id, ins):
                queue.put_nowait(_sse("studio", item))
            task = asyncio.create_task(narrate_ins(ins))
            tasks.add(task)
            task.add_done_callback(tasks.discard)

    def check_moments(t: float) -> None:
        check_insights(t)
        for m in an.moments(t):
            if m["id"] in sent_moments or m["type"] == "turning_point":
                continue
            sent_moments.add(m["id"])
            queue.put_nowait(_sse("moment", m))
            for item in producer.proposals_for_moment(match_id, m):
                queue.put_nowait(_sse("studio", item))
            task = asyncio.create_task(narrate_moment(m, t))
            tasks.add(task)
            task.add_done_callback(tasks.discard)

    async def produce_replay() -> None:
        events = [e for e in an.events if e["t"] >= start_t]
        last_t = start_t
        next_snapshot = start_t + 60
        if start_t < 120:
            for item in producer.propose(match_id, 0.0):      # real-data cards (head-to-head, Elo) from kick-off
                await queue.put(_sse("studio", item))
        for e in events:
            gap = (e["t"] - last_t) / speed
            if gap > 0:
                await asyncio.sleep(min(gap, 1.5))
            last_t = e["t"]
            await queue.put(_sse("event", e))
            notable = e["type"] in TRIGGER_TYPES and (e["type"] != "foul" or "penalty_conceded" in (e.get("tags") or []))
            if e["t"] >= next_snapshot or notable:
                await queue.put(_sse("snapshot", an.snapshot(e["t"])))
                while next_snapshot <= e["t"]:
                    next_snapshot += 60
                check_moments(e["t"])
        check_moments(an.end_t)
        await asyncio.sleep(0.5)
        await queue.put(_sse("end", {"t": an.end_t}))

    async def produce_eventhub() -> None:
        idx = 0
        next_snapshot = 60.0
        while True:
            buf = hub.events.get(match_id, [])
            while idx < len(buf):
                e = buf[idx]
                idx += 1
                await queue.put(_sse("event", e))
                if e["t"] >= next_snapshot or e["type"] in TRIGGER_TYPES:
                    await queue.put(_sse("snapshot", an.snapshot(e["t"])))
                    next_snapshot = e["t"] + 60
                    check_moments(e["t"])
                if e["type"] == "full_time":
                    await queue.put(_sse("end", {"t": e["t"]}))
                    return
            await hub.wait(match_id)

    yield _sse("meta", {"match_id": match_id, "speed": speed, "start_t": start_t, "duration_s": an.end_t,
                        "source": settings.live_source})
    producer_task = asyncio.create_task(produce_eventhub() if settings.live_source == "eventhub" else produce_replay())
    try:
        while True:
            item = await queue.get()
            yield item
            if item["event"] == "end":
                # let in-flight narratives land before closing
                if tasks:
                    await asyncio.wait(list(tasks), timeout=8)
                while not queue.empty():
                    yield queue.get_nowait()
                break
    finally:
        producer_task.cancel()
        for t in list(tasks):
            t.cancel()


async def overlay_stream(match_id: str):
    q = producer.subscribe(match_id)
    try:
        yield _sse("ready", {"match_id": match_id})
        while True:
            try:
                kind, item = await asyncio.wait_for(q.get(), timeout=20)
                yield _sse(kind, item)
            except TimeoutError:
                yield {"event": "ping", "data": "{}"}
    finally:
        producer.unsubscribe(match_id, q)


def latency_stats() -> dict:
    if not latency_samples:
        return {"p50_ms": None, "p95_ms": None, "samples": 0}
    s = sorted(latency_samples)
    return {"p50_ms": s[len(s) // 2], "p95_ms": s[min(len(s) - 1, int(len(s) * 0.95))], "samples": len(s)}
