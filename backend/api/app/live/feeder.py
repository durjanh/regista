"""Feeder job: publishes a match's events to Azure Event Hubs in (accelerated) real time.

Runs as a Container Apps Job:  python -m app.live.feeder --match-id 2026-07-15-england-argentina --speed 1
Each message body is the contract Event plus `match_id` and `emitted_at`; application properties carry
`match_id` and `type`; the partition key is the match id so a match's events stay ordered.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
from datetime import UTC, datetime

from ..config import settings
from ..store import store

log = logging.getLogger("regista.feeder")


async def feed(match_id: str, speed: float, start_t: float = 0.0) -> int:
    from azure.eventhub import EventData
    from azure.eventhub.aio import EventHubProducerClient
    from azure.identity.aio import DefaultAzureCredential

    doc = store.get(match_id)
    events = [e for e in doc["events"] if e["t"] >= start_t]
    sent = 0
    async with DefaultAzureCredential() as cred:
        producer = EventHubProducerClient(fully_qualified_namespace=settings.eventhub_fqdn, eventhub_name=settings.eventhub_name, credential=cred)
        async with producer:
            last_t = start_t
            for e in events:
                gap = (e["t"] - last_t) / max(speed, 0.1)
                if gap > 0:
                    await asyncio.sleep(min(gap, 120))
                last_t = e["t"]
                body = {**e, "match_id": match_id, "emitted_at": datetime.now(UTC).isoformat()}
                if e["type"] != "shot":
                    body.pop("freeze_frame", None)
                data = EventData(json.dumps(body, separators=(",", ":")))
                data.properties = {"match_id": match_id, "type": e["type"]}
                batch = await producer.create_batch(partition_key=match_id)
                batch.add(data)
                await producer.send_batch(batch)
                sent += 1
                if e["type"] in ("shot", "half_end", "full_time"):
                    log.info("%s %s' %s", match_id, e["minute"], e["type"])
    return sent


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Publish a match to Azure Event Hubs")
    parser.add_argument("--match-id", default=None, help="Match id (default: the most recent featured real match)")
    parser.add_argument("--speed", type=float, default=1.0, help="Replay speed multiplier (1 = real time)")
    parser.add_argument("--start-t", type=float, default=0.0)
    args = parser.parse_args()
    if not settings.eventhub_fqdn:
        raise SystemExit("EVENTHUB_FQDN is not set")
    store.load()
    match_id = args.match_id or store.summaries()[0]["match_id"]
    sent = asyncio.run(feed(match_id, args.speed, args.start_t))
    log.info("Published %d events for %s", sent, match_id)


if __name__ == "__main__":
    main()
