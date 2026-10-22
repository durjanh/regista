"""Best-effort persistence to Azure data services (all keyless, all optional).

- Cosmos DB (NoSQL, serverless): narratives, recaps, studio decisions and match metadata.
- Blob Storage: generated what-if datasets (and each full match, restored when the API starts) and synthesized audio.
- Microsoft Fabric OneLake: generated datasets land in the Lakehouse (Files/regista/...) for Spark/SQL analytics.

Writes never block or fail a user request: they run in the background and log on error.
"""

from __future__ import annotations

import asyncio
import json
import logging

from ..config import settings

log = logging.getLogger("regista.persistence")
_cosmos_db = None
_bg: set[asyncio.Task] = set()


def _spawn(coro) -> None:
    try:
        task = asyncio.get_running_loop().create_task(coro)
    except RuntimeError:          # no running loop (scripts, sync callers): drop the write cleanly
        coro.close()
        return
    _bg.add(task)
    task.add_done_callback(_bg.discard)


async def _cosmos():
    global _cosmos_db
    if _cosmos_db is None:
        from azure.cosmos.aio import CosmosClient

        from ..ai.clients import credential
        _cosmos_db = CosmosClient(settings.cosmos_endpoint, credential=credential()).get_database_client(settings.cosmos_database)
    return _cosmos_db


async def _upsert(container: str, item: dict) -> None:
    try:
        db = await _cosmos()
        await db.get_container_client(container).upsert_item(item)
    except Exception as exc:
        log.warning("Cosmos upsert to %s failed: %s", container, exc)


def save(container: str, item: dict) -> None:
    """Fire-and-forget upsert. Items need `id` and the container's partition key (`match_id` or `user_id`)."""
    if settings.cosmos_endpoint:
        _spawn(_upsert(container, json.loads(json.dumps(item, default=str))))


async def _blob(container: str, name: str, data: bytes, content_type: str) -> str | None:
    try:
        from azure.storage.blob import ContentSettings
        from azure.storage.blob.aio import BlobServiceClient

        from ..ai.clients import credential
        async with BlobServiceClient(settings.storage_account_url, credential=credential()) as svc:
            blob = svc.get_blob_client(container, name)
            await blob.upload_blob(data, overwrite=True, content_settings=ContentSettings(content_type=content_type))
            return blob.url
    except Exception as exc:
        log.warning("Blob upload %s/%s failed: %s", container, name, exc)
        return None


def save_blob(container: str, name: str, data: bytes, content_type: str = "application/json") -> None:
    if settings.storage_account_url:
        _spawn(_blob(container, name, data, content_type))


async def _onelake(path: str, data: bytes) -> None:
    try:
        from azure.storage.filedatalake.aio import DataLakeServiceClient

        from ..ai.clients import credential
        async with DataLakeServiceClient(settings.onelake_dfs_endpoint, credential=credential()) as svc:
            fs = svc.get_file_system_client(settings.onelake_workspace)
            f = fs.get_file_client(f"{settings.onelake_lakehouse}.Lakehouse/Files/{path}")
            await f.upload_data(data, overwrite=True)
    except Exception as exc:
        log.warning("OneLake upload %s failed: %s", path, exc)


MATCH_BLOB = "match.json"   # datasets/<match id>/match.json: the full document, so the API can restore the match


def export_dataset(doc: dict) -> None:
    """Write a generated match to Blob and to the Fabric Lakehouse as JSON (meta) and JSON Lines (events), plus the full
    document to Blob so the match survives the API restarting (Container Apps scale to zero)."""
    mid = doc["meta"]["match_id"]
    meta = json.dumps(doc["meta"], default=str).encode()
    events = "\n".join(json.dumps({**{k: v for k, v in e.items() if k != "freeze_frame"}}, default=str) for e in doc["events"]).encode()
    save_blob("datasets", f"{mid}/meta.json", meta)
    save_blob("datasets", f"{mid}/events.jsonl", events, "application/x-ndjson")
    save_blob("datasets", f"{mid}/{MATCH_BLOB}", json.dumps(doc, separators=(",", ":"), default=str).encode())
    if settings.onelake_workspace and settings.onelake_lakehouse:
        _spawn(_onelake(f"regista/matches/{mid}/meta.json", meta))
        _spawn(_onelake(f"regista/matches/{mid}/events.jsonl", events))


async def load_generated_matches() -> list[dict]:
    """Every generated match saved by export_dataset, for the store to restore at start-up. [] when Blob isn't
    configured or can't be read: a missing what-if must never stop the API from starting."""
    if not settings.storage_account_url:
        return []
    try:
        from azure.storage.blob.aio import BlobServiceClient

        from ..ai.clients import credential
        docs = []
        async with BlobServiceClient(settings.storage_account_url, credential=credential()) as svc:
            container = svc.get_container_client("datasets")
            async for blob in container.list_blobs():
                if blob.name.endswith(f"/{MATCH_BLOB}"):
                    data = await (await container.download_blob(blob.name)).readall()
                    docs.append(json.loads(data))
        return docs
    except Exception as exc:
        log.warning("Could not restore generated matches from Blob: %s", exc)
        return []


def status() -> dict:
    return {"cosmos": bool(settings.cosmos_endpoint), "blob": bool(settings.storage_account_url),
            "onelake": bool(settings.onelake_workspace and settings.onelake_lakehouse)}
