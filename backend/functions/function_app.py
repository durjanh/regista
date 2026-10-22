"""Regista recap automation (Azure Functions, Python v2 programming model).

Listens to the live `match-events` Event Hub. When a `full_time` event arrives, it asks the Regista API
for the broadcaster recap (multi-agent workflow in Microsoft Foundry), then persists the result:

* Cosmos DB `recaps` container (partition key `/match_id`), for the studio and fan apps
* Blob Storage `recaps/{match_id}.json`, for downstream tools (CMS, social scheduling, Fabric)

Event Hubs delivers at least once, so every write is an idempotent upsert keyed by match, persona and
language. All connections use the app's user-assigned managed identity, with no keys or connection strings.
"""

import json
import logging
import os
from datetime import datetime, timezone
from functools import lru_cache
from typing import List

import azure.functions as func
import requests
from azure.cosmos import CosmosClient
from azure.identity import DefaultAzureCredential
from azure.storage.blob import BlobServiceClient, ContentSettings

app = func.FunctionApp()
log = logging.getLogger("regista.recaps")

RECAP_PERSONA = os.getenv("RECAP_PERSONA", "broadcaster")
RECAP_LANGUAGE = os.getenv("RECAP_LANGUAGE", "en")
RECAP_TIMEOUT_S = int(os.getenv("RECAP_TIMEOUT_S", "180"))


@lru_cache(maxsize=1)
def _credential() -> DefaultAzureCredential:
    # AZURE_CLIENT_ID selects the user-assigned managed identity in Azure; locally `az login` is used.
    return DefaultAzureCredential(managed_identity_client_id=os.getenv("AZURE_CLIENT_ID"))


@lru_cache(maxsize=1)
def _recaps_container():
    endpoint = os.getenv("COSMOS_ENDPOINT")
    if not endpoint:
        return None
    client = CosmosClient(endpoint, credential=_credential())
    return client.get_database_client(os.getenv("COSMOS_DATABASE", "regista")).get_container_client("recaps")


@lru_cache(maxsize=1)
def _blob_service():
    account_url = os.getenv("STORAGE_ACCOUNT_URL")
    return BlobServiceClient(account_url, credential=_credential()) if account_url else None


def _parse(event: func.EventHubEvent) -> dict | None:
    try:
        return json.loads(event.get_body().decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        log.warning("Skipping non-JSON event at sequence %s", event.sequence_number)
        return None


def generate_recap(match_id: str) -> dict:
    api = os.environ["REGISTA_API_URL"].rstrip("/")
    response = requests.post(
        f"{api}/api/recap",
        json={"match_id": match_id, "persona": RECAP_PERSONA, "language": RECAP_LANGUAGE},
        timeout=RECAP_TIMEOUT_S,
    )
    response.raise_for_status()
    return response.json()


def persist_recap(match_id: str, recap: dict) -> None:
    document = {
        "id": f"{match_id}:{RECAP_PERSONA}:{RECAP_LANGUAGE}",
        "match_id": match_id,
        "persona": RECAP_PERSONA,
        "language": RECAP_LANGUAGE,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "functions/full-time-trigger",
        "recap": recap,
    }

    container = _recaps_container()
    if container is not None:
        container.upsert_item(document)

    blobs = _blob_service()
    if blobs is not None:
        blobs.get_blob_client("recaps", f"{match_id}.json").upload_blob(
            json.dumps(document, ensure_ascii=False, indent=2).encode("utf-8"),
            overwrite=True,
            content_settings=ContentSettings(content_type="application/json"),
        )


@app.function_name("on_match_events")
@app.event_hub_message_trigger(
    arg_name="events",
    event_hub_name="%EVENTHUB_NAME%",
    connection="EventHubConnection",
    consumer_group="%EVENTHUB_CONSUMER_GROUP%",
    cardinality="many",
)
def on_match_events(events: List[func.EventHubEvent]) -> None:   # typing.List: the worker rejects list[...] here
    """Fan-in on the live feed; acts only on full-time whistles."""
    finished = set()
    for event in events:
        body = _parse(event)
        if body and body.get("type") == "full_time" and body.get("match_id"):
            finished.add(body["match_id"])

    for match_id in finished:
        try:
            recap = generate_recap(match_id)
            persist_recap(match_id, recap)
            log.info(
                "Recap stored for %s (engine=%s, fact_check=%s)",
                match_id,
                recap.get("engine"),
                (recap.get("fact_check") or {}).get("passed"),
            )
        except requests.RequestException:
            # Re-raise so the batch is retried rather than silently losing the recap.
            log.exception("Recap generation failed for %s", match_id)
            raise


@app.function_name("health")
@app.route(route="health", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def health(req: func.HttpRequest) -> func.HttpResponse:
    status = {
        "status": "ok",
        "service": "regista-functions",
        "api": os.getenv("REGISTA_API_URL", ""),
        "cosmos": bool(os.getenv("COSMOS_ENDPOINT")),
        "storage": bool(os.getenv("STORAGE_ACCOUNT_URL")),
    }
    return func.HttpResponse(json.dumps(status), mimetype="application/json")
