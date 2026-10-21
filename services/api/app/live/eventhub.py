"""Azure Event Hubs consumer for the live pipeline (LIVE_SOURCE=eventhub).

Each API replica reads every partition of `match-events` with its own consumer group and no checkpointing:
the stream is broadcast to that replica's viewers. Identity-based auth (managed identity), no connection strings.
"""

from __future__ import annotations

import asyncio
import json
import logging

from ..config import settings
from .replay import hub

log = logging.getLogger("regista.eventhub")


async def consume_forever() -> None:
    from azure.eventhub.aio import EventHubConsumerClient

    from ..ai.clients import credential

    async def on_event(partition_context, event) -> None:
        if event is None:
            return
        try:
            hub.push(json.loads(event.body_as_str()))
        except Exception as exc:
            log.warning("Bad event payload: %s", exc)

    while True:
        try:
            client = EventHubConsumerClient(fully_qualified_namespace=settings.eventhub_fqdn, eventhub_name=settings.eventhub_name,
                                            consumer_group=settings.eventhub_consumer_group, credential=credential())
            async with client:
                log.info("Consuming %s/%s as %s", settings.eventhub_fqdn, settings.eventhub_name, settings.eventhub_consumer_group)
                await client.receive(on_event=on_event, starting_position="@latest", max_wait_time=5)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.warning("Event Hubs consumer error, retrying in 5 s: %s", exc)
            await asyncio.sleep(5)
