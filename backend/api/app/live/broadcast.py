"""Shared live broadcast over Azure Web PubSub: one timeline per match, published once, fanned out to every viewer.

The SSE stream in replay.py is a personal replay (each viewer has their own speed, start and persona, and each
connection is held by the API). A broadcast is the opposite: the API publishes ONE batched `tick` per second to the
Web PubSub group `match.{id}`, and Web PubSub delivers it to every connected viewer (1,000 connections per unit,
up to 100 units per resource). Narratives are generated once per language and published to `match.{id}.{lang}`;
studio cues go to `overlay.{id}`. Cost and load on the API stay flat as the audience grows.

Sources: a shared server-side replay started from the Studio, or LIVE_SOURCE=eventhub (feeder -> Event Hubs ->
LiveHub). Keyless: client tokens are issued with Microsoft Entra ID (Web PubSub Service Owner); no access keys.
Web PubSub bills every outbound delivery in 2 KB chunks, so ticks are batched and carry no freeze frames.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime

from ..ai import producer
from ..ai.narrator import narrate, narrate_insight
from ..ai.personas import LANGUAGES
from ..analytics.engine import minute_of
from ..brand_safe import ENABLED as VIDEO_SAFE
from ..brand_safe import scrub
from ..config import settings
from ..store import store
from .replay import hub

log = logging.getLogger("regista.broadcast")
TICK_SECONDS = 1.0                    # one batched message per second per viewer
NARRATIVE_PERSONA = "broadcaster"     # one voice for the shared feed; personal personas stay on the SSE replay
_client = None


def match_group(match_id: str) -> str:
    return f"match.{match_id}"


def language_group(match_id: str, language: str) -> str:
    return f"match.{match_id}.{language}"


def overlay_group(match_id: str) -> str:
    return f"overlay.{match_id}"


def enabled() -> bool:
    return settings.webpubsub


def client():
    """Async Web PubSub service client, Entra-authenticated (managed identity in Azure, az login locally)."""
    global _client
    if _client is None:
        from azure.messaging.webpubsubservice.aio import WebPubSubServiceClient

        from ..ai.clients import credential
        _client = WebPubSubServiceClient(endpoint=settings.webpubsub_endpoint, hub=settings.webpubsub_hub, credential=credential())
    return _client


async def negotiate(match_id: str, language: str = "en") -> dict:
    """A short-lived client URL allowed to join exactly this match's groups (and nothing else)."""
    if not enabled():
        return {"enabled": False}
    groups = [match_group(match_id), language_group(match_id, language), overlay_group(match_id)]
    token = await client().get_client_access_token(roles=[f"webpubsub.joinLeaveGroup.{g}" for g in groups], minutes_to_expire=60)
    return {"enabled": True, "url": token["url"], "groups": groups, "hub": settings.webpubsub_hub}


def _encode(payload: dict) -> str:
    text = json.dumps(payload, default=str, separators=(",", ":"))
    return scrub(text) if VIDEO_SAFE else text


async def publish(group: str, payload: dict) -> int:
    """Send one JSON message to a group. Returns the bytes sent; 0 when offline or on failure. Never raises."""
    if not enabled():
        return 0
    text = _encode(payload)
    try:
        await client().send_to_group(group, text, content_type="application/json")
        return len(text.encode())
    except Exception as exc:
        log.warning("Web PubSub publish to %s failed: %s", group, exc)
        return 0


def _slim_event(e: dict) -> dict:
    return {k: v for k, v in e.items() if k != "freeze_frame"}


@dataclass
class Broadcast:
    match_id: str
    source: str
    speed: float = 1.0
    start_t: float = 0.0
    languages: list[str] = field(default_factory=lambda: ["en"])
    live: bool = False
    t: float = 0.0
    minute: int = 0
    seq: int = 0
    started_at: str | None = None
    ticks_published: int = 0
    bytes_published: int = 0
    task: asyncio.Task | None = None
    sent_moments: set[str] = field(default_factory=set)
    sent_insights: set[str] = field(default_factory=set)
    narration: set[asyncio.Task] = field(default_factory=set)
    viewers: int = 0                  # connections in the match group (Web PubSub), refreshed in the background
    viewers_more: bool = False        # more than settings.broadcast_viewer_count_max: shown as "N+"
    counter: asyncio.Task | None = None
    counted_at: float = 0.0

    def status(self) -> dict:
        return {"match_id": self.match_id, "live": self.live, "source": self.source, "speed": self.speed, "t": self.t,
                "minute": self.minute, "started_at": self.started_at, "ticks_published": self.ticks_published,
                "bytes_published": self.bytes_published, "languages": self.languages,
                "viewers": self.viewers, "viewers_more": self.viewers_more}

    def refresh_viewers(self) -> None:
        """Count who is watching every few seconds, in the background so a slow count never delays a tick."""
        now = time.monotonic()
        if not enabled() or (self.counter and not self.counter.done()) or now - self.counted_at < settings.broadcast_viewer_count_interval_s:
            return
        self.counted_at = now
        self.counter = asyncio.create_task(self.count_viewers())

    async def count_viewers(self) -> None:
        """Web PubSub lists the connections in the match group; stop one past the cap, so 100,000 viewers stay cheap."""
        cap = settings.broadcast_viewer_count_max
        try:
            n = 0
            async for _ in client().list_connections(group=match_group(self.match_id), top=cap + 1):
                n += 1
            self.viewers, self.viewers_more = min(n, cap), n > cap
        except Exception as exc:  # the count is informative only: keep the last value
            log.warning("Viewer count for %s failed: %s", self.match_id, exc)

    async def _send(self, group: str, payload: dict) -> None:
        sent = await publish(group, payload)
        if sent:
            self.bytes_published += sent

    def _narrate(self, ref_type: str, item: dict, t: float) -> None:
        """Queue one narrative per language for a new moment or insight; generated once, whatever the audience size."""
        async def run(language: str) -> None:
            try:
                if ref_type == "moment":
                    n = await narrate(self.match_id, "moment", NARRATIVE_PERSONA, language, moment_id=item["id"], upto_t=t)
                else:
                    n = await narrate_insight(self.match_id, item, "analyst", language)
                await self._send(language_group(self.match_id, language), {
                    "type": "narrative", "match_id": self.match_id, "ref_type": ref_type, "ref_id": item["id"], "language": language,
                    "scope": n.get("scope", ref_type), "persona": n.get("persona"), "engine": n.get("engine"),
                    "text": n["text"], "citations": n.get("citations", []), "fact_check": n.get("fact_check"),
                    "verification": n.get("verification")})
            except Exception as exc:
                log.warning("Broadcast narrative %s/%s (%s) failed: %s", ref_type, item.get("id"), language, exc)

        for language in self.languages:
            task = asyncio.create_task(run(language))
            self.narration.add(task)
            task.add_done_callback(self.narration.discard)

    def seed(self, t: float) -> None:
        """Moments and insights before the broadcast starts are history: don't replay them all in the first tick."""
        an = store.analyzer(self.match_id)
        self.sent_moments |= {m["id"] for m in an.moments(t)} if t > 0 else set()
        self.sent_insights |= {i["id"] for i in an.insights(t) if i["detected_t"] <= t} if t > 0 else set()

    async def tick(self, events: list[dict], t: float) -> dict:
        """Publish one batched tick: events since the last tick, a light snapshot, and newly detected moments/insights."""
        an = store.analyzer(self.match_id)
        self.t, self.minute = t, minute_of(t, an.meta)
        snap = an.snapshot(t)
        moments = [m for m in an.moments(t) if m["id"] not in self.sent_moments and m["type"] != "turning_point"]
        insights = [i for i in an.insights(t) if i["id"] not in self.sent_insights and i["detected_t"] <= t]
        for m in moments:
            self.sent_moments.add(m["id"])
            producer.proposals_for_moment(self.match_id, m)
            self._narrate("moment", m, t)
        for ins in insights:
            self.sent_insights.add(ins["id"])
            producer.proposals_for_insight(self.match_id, ins)
            self._narrate("insight", ins, t)
        self.refresh_viewers()
        self.seq += 1
        payload = {"type": "tick", "match_id": self.match_id, "seq": self.seq, "sent_at": int(time.time() * 1000), "t": t,
                   "minute": self.minute, "score": snap["score"], "events": [_slim_event(e) for e in events],
                   "snapshot": {"momentum": snap["momentum"], "win_prob": snap["win_prob"], "control_chaos": snap["control_chaos"]},
                   "moments": moments, "insights": insights}
        sent = await publish(match_group(self.match_id), payload)
        if sent:
            self.ticks_published += 1
            self.bytes_published += sent
        return payload

    async def end(self, t: float) -> None:
        if self.narration:
            await asyncio.wait(list(self.narration), timeout=8)
        await self._send(match_group(self.match_id), {"type": "end", "match_id": self.match_id, "t": t})
        self.live = False

    async def run_replay(self) -> None:
        """Shared replay: the clock advances `speed` match-seconds per tick for everyone at once."""
        an = store.analyzer(self.match_id)
        self.seed(self.start_t)
        events = [e for e in an.events if e["t"] >= self.start_t]
        clock, i = self.start_t, 0
        while i < len(events):
            clock += self.speed            # `speed` match-seconds per tick (one tick per wall-clock second)
            batch = []
            while i < len(events) and events[i]["t"] <= clock:
                batch.append(events[i])
                i += 1
            await self.tick(batch, min(clock, an.end_t))
            await asyncio.sleep(TICK_SECONDS)
        await self.end(an.end_t)

    async def run_eventhub(self) -> None:
        """Live source: events land in the LiveHub from Event Hubs; publish what arrived each second."""
        idx = 0
        while True:
            buf = hub.events.get(self.match_id, [])
            if idx > len(buf):        # a new feed restarted the buffer (seq 1)
                idx = 0
            batch, idx = buf[idx:], len(buf)
            await self.tick(batch, batch[-1]["t"] if batch else self.t)
            if any(e.get("type") == "full_time" for e in batch):
                await self.end(batch[-1]["t"])
                return
            await asyncio.sleep(TICK_SECONDS)


_broadcasts: dict[str, Broadcast] = {}
_cue_tasks: set[asyncio.Task] = set()


async def _guarded(b: Broadcast) -> None:
    try:
        await (b.run_eventhub() if b.source == "eventhub" else b.run_replay())
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # never let one match's failure take the API down
        log.exception("Broadcast %s stopped: %s", b.match_id, exc)
    finally:
        b.live = False


def start(match_id: str, speed: float = 1.0, start_t: float = 0.0, languages: list[str] | None = None) -> dict:
    """Start (or return) the shared live timeline for a match. Idempotent while it is live."""
    current = _broadcasts.get(match_id)
    if current and current.live:
        return current.status()
    langs = [lang for lang in dict.fromkeys(languages or ["en"]) if lang in LANGUAGES] or ["en"]
    b = Broadcast(match_id=match_id, source="eventhub" if settings.live_source == "eventhub" else "replay",
                  speed=max(1.0, min(float(speed), 600.0)), start_t=max(0.0, float(start_t)), languages=langs,
                  live=True, t=max(0.0, float(start_t)), started_at=datetime.now(UTC).isoformat(timespec="seconds"))
    _broadcasts[match_id] = b
    b.task = asyncio.create_task(_guarded(b))
    return b.status()


def stop(match_id: str) -> dict:
    b = _broadcasts.get(match_id)
    if not b:
        return Broadcast(match_id=match_id, source=settings.live_source).status()
    if b.task and not b.task.done():
        b.task.cancel()
    for task in list(b.narration):
        task.cancel()
    b.live = False
    return b.status()


def status() -> list[dict]:
    return [b.status() for b in _broadcasts.values()]


async def shutdown() -> None:
    for match_id in list(_broadcasts):
        stop(match_id)
    if _client is not None:
        try:
            await _client.close()
        except Exception:
            pass


def _on_cue(match_id: str, kind: str, payload: dict) -> None:
    """Studio on_air / kill -> overlay.{match_id}, so every broadcast overlay updates at once."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    task = loop.create_task(publish(overlay_group(match_id), {"type": "cue", "match_id": match_id, "action": kind, "item": payload}))
    _cue_tasks.add(task)
    task.add_done_callback(_cue_tasks.discard)


producer.cue_listeners.append(_on_cue)
