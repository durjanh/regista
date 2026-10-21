#!/usr/bin/env python3
"""Provision the Microsoft Fabric side of Regista with the Fabric REST API.

Creates (or reuses):
  * a workspace, optionally assigned to a Fabric capacity (paid F-SKU or a trial capacity)
  * a Lakehouse ``regista_lakehouse`` where Data Forge exports synthetic match datasets (OneLake)
  * an Eventhouse ``regista_eventhouse`` with a KQL database ``regista_live`` and a ``match_events``
    table + JSON ingestion mapping, the destination for the live Eventstream
  * a Contributor workspace role for the API's managed identity so it can write to OneLake
  * the real CC0 reference dataset (``data/reference/international-results/*.csv``) uploaded to the
    Lakehouse ``Files/reference/`` folder, so real results sit next to the synthetic events in Fabric
  * the workspace identity, granted *Azure Event Hubs Data Receiver* on the namespace (keyless: Event Hubs has
    local auth disabled, and workspace identity is the keyless option Fabric documents for this source)
  * the Eventstream ``regista_live`` (Event Hubs ``match-events`` / consumer group ``fabric`` -> ``match_events``),
    once a Fabric connection to the namespace exists (--eventhub-connection-id). The Connections API doesn't
    document Event Hubs + workspace identity, so that connection is the one portal step (docs/DEPLOYMENT.md).

Without --capacity-name/--capacity-id it uses your active Fabric **trial** capacity (start it once at
https://app.fabric.microsoft.com). Every step is find-or-create, so re-running changes nothing.
Run by azd (deploy/hooks/fabric.sh) when FABRIC_WORKSPACE_NAME is set, or by hand.

Auth: DefaultAzureCredential (``az login`` locally, OIDC in CI). The caller must be allowed to create
workspaces in the Fabric tenant and be an admin of the capacity.

Usage:
  pip install azure-identity
  python scripts/fabric-setup.py --workspace "Regista" --capacity-name fabregistaxxxx \\
      --resource-group rg-regista --identity-name id-regista-xxxx
"""

from __future__ import annotations

import argparse
import base64
import json
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request

from azure.identity import DefaultAzureCredential

FABRIC_API = "https://api.fabric.microsoft.com/v1"
FABRIC_SCOPE = "https://api.fabric.microsoft.com/.default"
ONELAKE_DFS = "https://onelake.dfs.fabric.microsoft.com"
STORAGE_SCOPE = "https://storage.azure.com/.default"
REFERENCE_DIR = pathlib.Path(__file__).resolve().parent.parent / "data" / "reference" / "international-results"

LAKEHOUSE_NAME = "regista_lakehouse"
EVENTHOUSE_NAME = "regista_eventhouse"
KQL_DATABASE_NAME = "regista_live"
EVENTSTREAM_NAME = "regista_live_stream"
EVENT_HUBS_RECEIVER_ROLE = "Azure Event Hubs Data Receiver"

# Table + mapping for the contract `Event` JSON (plus match_id and the feeder's emitted_at timestamp).
MATCH_EVENTS_SCHEMA = r"""
.create-merge table match_events (
    match_id: string, id: string, seq: int, period: int, t: real, minute: int, type: string,
    team_id: string, player_id: string, player_name: string,
    x: real, y: real, end_x: real, end_y: real, outcome: string,
    pass_type: string, situation: string, shot_outcome: string, xg: real, xt_added: real,
    score_home: int, score_away: int, tags: dynamic, emitted_at: datetime, raw: dynamic
)
.create-or-alter table match_events ingestion json mapping 'match_events_json' '[{"column":"match_id","Properties":{"Path":"$.match_id"}},{"column":"id","Properties":{"Path":"$.id"}},{"column":"seq","Properties":{"Path":"$.seq"}},{"column":"period","Properties":{"Path":"$.period"}},{"column":"t","Properties":{"Path":"$.t"}},{"column":"minute","Properties":{"Path":"$.minute"}},{"column":"type","Properties":{"Path":"$.type"}},{"column":"team_id","Properties":{"Path":"$.team_id"}},{"column":"player_id","Properties":{"Path":"$.player_id"}},{"column":"player_name","Properties":{"Path":"$.player_name"}},{"column":"x","Properties":{"Path":"$.x"}},{"column":"y","Properties":{"Path":"$.y"}},{"column":"end_x","Properties":{"Path":"$.end_x"}},{"column":"end_y","Properties":{"Path":"$.end_y"}},{"column":"outcome","Properties":{"Path":"$.outcome"}},{"column":"pass_type","Properties":{"Path":"$.pass_type"}},{"column":"situation","Properties":{"Path":"$.situation"}},{"column":"shot_outcome","Properties":{"Path":"$.shot_outcome"}},{"column":"xg","Properties":{"Path":"$.xg"}},{"column":"xt_added","Properties":{"Path":"$.xt_added"}},{"column":"score_home","Properties":{"Path":"$.score.home"}},{"column":"score_away","Properties":{"Path":"$.score.away"}},{"column":"tags","Properties":{"Path":"$.tags"}},{"column":"emitted_at","Properties":{"Path":"$.emitted_at"}},{"column":"raw","Properties":{"Path":"$"}}]'
.alter table match_events policy retention @'{"SoftDeletePeriod":"30.00:00:00","Recoverability":"Enabled"}'
"""


class Fabric:
    def __init__(self) -> None:
        self.credential = DefaultAzureCredential()
        self._token: str | None = None
        self._expires = 0.0

    def _auth(self) -> str:
        if not self._token or time.time() > self._expires - 120:
            tok = self.credential.get_token(FABRIC_SCOPE)
            self._token, self._expires = tok.token, tok.expires_on
        return self._token

    def request(self, method: str, path: str, body: dict | None = None) -> tuple[int, dict, dict]:
        url = path if path.startswith("https://") else f"{FABRIC_API}{path}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self._auth()}")
        req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req) as resp:
                raw = resp.read()
                return resp.status, dict(resp.headers), (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as err:
            detail = err.read().decode(errors="replace")
            raise SystemExit(f"Fabric API {method} {path} failed: HTTP {err.code}\n{detail}") from None

    def create_item(self, path: str, body: dict) -> dict:
        """POST an item and follow the long-running operation if the API returns 202."""
        status, headers, payload = self.request("POST", path, body)
        if status in (200, 201):
            return payload
        location = headers.get("Location") or headers.get("location")
        if status != 202 or not location:
            raise SystemExit(f"Unexpected response {status} from {path}: {payload}")
        while True:
            time.sleep(int(headers.get("Retry-After", "5")))
            _, headers, op = self.request("GET", location)
            state = op.get("status")
            if state == "Succeeded":
                _, _, result = self.request("GET", f"{location}/result")
                return result
            if state in ("Failed", "Cancelled"):
                raise SystemExit(f"Operation on {path} {state}: {json.dumps(op.get('error'), indent=2)}")

    def try_request(self, method: str, path: str, body: dict | None = None) -> tuple[int, dict, dict] | None:
        """Like request(), but report a failure instead of stopping: optional steps must not break a provision."""
        try:
            return self.request(method, path, body)
        except SystemExit as err:
            print(f"⚠ {err}")
            return None

    def find(self, path: str, display_name: str) -> dict | None:
        _, _, payload = self.request("GET", path)
        return next((i for i in payload.get("value", []) if i.get("displayName") == display_name), None)


def upload_reference_files(credential: DefaultAzureCredential, workspace_id: str, lakehouse_id: str) -> None:
    """Upload the CC0 reference CSVs to Files/reference/ through the OneLake ADLS Gen2 (DFS) API."""
    files = sorted(REFERENCE_DIR.glob("*.csv"))
    if not files:
        print(f"No reference CSVs found in {REFERENCE_DIR}; skipping upload.")
        return
    token = credential.get_token(STORAGE_SCOPE).token

    def call(method: str, url: str, data: bytes | None = None) -> None:
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {token}")
        req.add_header("x-ms-version", "2023-11-03")
        if data is not None:
            req.add_header("Content-Length", str(len(data)))
        try:
            urllib.request.urlopen(req).read()
        except urllib.error.HTTPError as err:
            raise SystemExit(f"OneLake {method} {url} failed: HTTP {err.code}\n{err.read().decode(errors='replace')}") from None

    for path in files:
        data = path.read_bytes()
        url = f"{ONELAKE_DFS}/{workspace_id}/{lakehouse_id}/Files/reference/{path.name}"
        call("PUT", f"{url}?resource=file")  # create (or truncate) the file
        call("PATCH", f"{url}?action=append&position=0", data)
        call("PATCH", f"{url}?action=flush&position={len(data)}", b"")
        print(f"Uploaded Files/reference/{path.name} ({len(data) / 1_048_576:.1f} MB)")


def b64(text: str) -> str:
    return base64.b64encode(text.encode()).decode()


def az_tsv(*args: str) -> str:
    return subprocess.run(["az", *args, "-o", "tsv"], check=True, capture_output=True, text=True).stdout.strip()


def eventstream_definition(connection_id: str, workspace_id: str, database: dict) -> dict:
    """Event Hubs (consumer group fabric) -> default stream -> Eventhouse table match_events (processed ingestion:
    JSON fields map to columns by name). Shapes from Microsoft Learn: Eventstream item definition + REST API."""
    spec = {
        "sources": [{
            "name": "match-events", "type": "AzureEventHub",
            "properties": {"dataConnectionId": connection_id, "consumerGroupName": "fabric",
                           "inputSerialization": {"type": "Json", "properties": {"encoding": "UTF8"}}},
        }],
        "streams": [{"name": f"{EVENTSTREAM_NAME}-stream", "type": "DefaultStream", "properties": {},
                     "inputNodes": [{"name": "match-events"}]}],
        "destinations": [{
            "name": "regista-eventhouse", "type": "Eventhouse",
            "properties": {"dataIngestionMode": "ProcessedIngestion", "workspaceId": workspace_id, "itemId": database["id"],
                           "databaseName": KQL_DATABASE_NAME, "tableName": "match_events",
                           "inputSerialization": {"type": "Json", "properties": {"encoding": "UTF8"}}},
            "inputNodes": [{"name": f"{EVENTSTREAM_NAME}-stream"}],
        }],
        "operators": [],
        "compatibilityLevel": "1.0",
    }
    return {"parts": [{"path": "eventstream.json", "payload": b64(json.dumps(spec)), "payloadType": "InlineBase64"}]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--workspace", default="Regista", help="Fabric workspace display name")
    parser.add_argument("--capacity-name", help="Fabric capacity display name (Azure resource name or trial capacity name)")
    parser.add_argument("--capacity-id", help="Fabric capacity id (alternative to --capacity-name)")
    parser.add_argument("--resource-group", help="Azure resource group, used to look up the workload identity")
    parser.add_argument("--identity-name", help="User-assigned managed identity name (output IDENTITY_NAME)")
    parser.add_argument("--identity-principal-id", help="Principal (object) id of the workload identity")
    parser.add_argument("--skip-reference-upload", action="store_true", help="Don't upload the CC0 reference CSVs to the Lakehouse")
    parser.add_argument("--eventhub-namespace", help="Event Hubs namespace name (grants the workspace identity Data Receiver)")
    parser.add_argument("--eventhub-connection-id", help="Fabric connection id for the Event Hubs namespace (creates the Eventstream)")
    parser.add_argument("--skip-eventstream", action="store_true", help="No workspace identity or Eventstream (e.g. private Event Hubs)")
    args = parser.parse_args()

    fabric = Fabric()

    # Capacity ------------------------------------------------------------------------------------
    capacity_id = args.capacity_id
    if not capacity_id and args.capacity_name:
        cap = fabric.find("/capacities", args.capacity_name)
        if not cap:
            raise SystemExit(f"Capacity '{args.capacity_name}' not found or you are not an admin of it.")
        if cap.get("state") != "Active":
            raise SystemExit(f"Capacity '{args.capacity_name}' is {cap.get('state')}. Resume it first.")
        capacity_id = cap["id"]
    if not capacity_id:
        _, _, caps = fabric.request("GET", "/capacities")
        trial = next((c for c in caps.get("value", []) if str(c.get("sku", "")).upper().startswith("FT") and c.get("state") == "Active"), None)
        if not trial:
            raise SystemExit("No capacity given and no active Fabric trial found. Start the free trial at https://app.fabric.microsoft.com "
                             "(signed in as the deploying account) or pass --capacity-name.")
        capacity_id = trial["id"]
        print(f"Using the Fabric trial capacity '{trial.get('displayName')}' ({trial.get('region')})")

    # Workspace -----------------------------------------------------------------------------------
    workspace = fabric.find("/workspaces", args.workspace)
    if workspace:
        print(f"Workspace '{args.workspace}' exists ({workspace['id']})")
    else:
        body = {"displayName": args.workspace, "description": "Regista: synthetic football match intelligence"}
        if capacity_id:
            body["capacityId"] = capacity_id
        workspace = fabric.create_item("/workspaces", body)
        print(f"Created workspace '{args.workspace}' ({workspace['id']})")
    ws = workspace["id"]

    if capacity_id and workspace.get("capacityId") != capacity_id:
        fabric.request("POST", f"/workspaces/{ws}/assignToCapacity", {"capacityId": capacity_id})
        print(f"Assigned workspace to capacity {capacity_id}")

    # Lakehouse -----------------------------------------------------------------------------------
    lakehouse = fabric.find(f"/workspaces/{ws}/lakehouses", LAKEHOUSE_NAME) or fabric.create_item(
        f"/workspaces/{ws}/lakehouses",
        {"displayName": LAKEHOUSE_NAME, "description": "Data Forge synthetic match datasets (JSON + Parquet)"},
    )
    print(f"Lakehouse {LAKEHOUSE_NAME}: {lakehouse['id']}")
    if not args.skip_reference_upload:
        upload_reference_files(fabric.credential, ws, lakehouse["id"])

    # Eventhouse + KQL database with schema ------------------------------------------------------
    eventhouse = fabric.find(f"/workspaces/{ws}/eventhouses", EVENTHOUSE_NAME) or fabric.create_item(
        f"/workspaces/{ws}/eventhouses", {"displayName": EVENTHOUSE_NAME, "description": "Live match events (Real-Time Intelligence)"}
    )
    print(f"Eventhouse {EVENTHOUSE_NAME}: {eventhouse['id']}")

    database = fabric.find(f"/workspaces/{ws}/kqlDatabases", KQL_DATABASE_NAME)
    if not database:
        properties = {"databaseType": "ReadWrite", "parentEventhouseItemId": eventhouse["id"]}
        database = fabric.create_item(
            f"/workspaces/{ws}/kqlDatabases",
            {
                "displayName": KQL_DATABASE_NAME,
                "definition": {
                    "parts": [
                        {"path": "DatabaseProperties.json", "payload": b64(json.dumps(properties)), "payloadType": "InlineBase64"},
                        {"path": "DatabaseSchema.kql", "payload": b64(MATCH_EVENTS_SCHEMA.strip()), "payloadType": "InlineBase64"},
                    ]
                },
            },
        )
    print(f"KQL database {KQL_DATABASE_NAME}: {database['id']} (table match_events, mapping match_events_json)")

    # Workspace access for the API's managed identity ---------------------------------------------
    principal_id = args.identity_principal_id
    if not principal_id and args.resource_group and args.identity_name:
        principal_id = az_tsv("identity", "show", "-g", args.resource_group, "-n", args.identity_name, "--query", "principalId")
    if principal_id:
        _, _, existing = fabric.request("GET", f"/workspaces/{ws}/roleAssignments")
        if any(r.get("principal", {}).get("id") == principal_id for r in existing.get("value", [])):
            print("Workload identity already has workspace access")
        else:
            fabric.request(
                "POST",
                f"/workspaces/{ws}/roleAssignments",
                {"principal": {"id": principal_id, "type": "ServicePrincipal"}, "role": "Contributor"},
            )
            print("Granted the workload identity Contributor on the workspace (OneLake writes)")
    else:
        print("Skipped workspace access for the API identity (pass --resource-group and --identity-name).")

    # Workspace identity -> Event Hubs Data Receiver (keyless source for the Eventstream) ------------
    if not args.skip_eventstream and args.eventhub_namespace:
        _, _, details = fabric.request("GET", f"/workspaces/{ws}")
        identity = details.get("workspaceIdentity")
        if not identity:
            try:
                identity = fabric.create_item(f"/workspaces/{ws}/provisionIdentity", {})
            except SystemExit as err:
                print(f"⚠ Could not provision the workspace identity: {err}")
        sp_id = (identity or {}).get("servicePrincipalId")
        if sp_id:
            try:
                namespace_id = az_tsv("eventhubs", "namespace", "list", "--query", f"[?name=='{args.eventhub_namespace}'].id | [0]")
                held = az_tsv("role", "assignment", "list", "--assignee", sp_id, "--role", EVENT_HUBS_RECEIVER_ROLE,
                              "--scope", namespace_id, "--query", "length(@)")
                if held in ("", "0"):   # create only if missing: re-runs never fail
                    subprocess.run(["az", "role", "assignment", "create", "--assignee-object-id", sp_id, "--assignee-principal-type",
                                    "ServicePrincipal", "--role", EVENT_HUBS_RECEIVER_ROLE, "--scope", namespace_id, "-o", "none"],
                                   check=True, capture_output=True, text=True)
                print(f"Workspace identity {sp_id} has '{EVENT_HUBS_RECEIVER_ROLE}' on {args.eventhub_namespace}")
            except subprocess.CalledProcessError as err:
                print(f"⚠ Could not grant '{EVENT_HUBS_RECEIVER_ROLE}' to the workspace identity: {err.stderr or err}")

    # Eventstream ----------------------------------------------------------------------------------
    if args.skip_eventstream:
        print("Skipped the Eventstream (--skip-eventstream).")
    elif fabric.find(f"/workspaces/{ws}/eventstreams", EVENTSTREAM_NAME):
        print(f"Eventstream {EVENTSTREAM_NAME} exists")
    elif args.eventhub_connection_id:
        try:
            stream = fabric.create_item(f"/workspaces/{ws}/eventstreams", {
                "displayName": EVENTSTREAM_NAME, "description": "match-events (Event Hubs, consumer group fabric) -> match_events",
                "definition": eventstream_definition(args.eventhub_connection_id, ws, database)})
            print(f"Created Eventstream {EVENTSTREAM_NAME}: {stream.get('id')}")
        except SystemExit as err:
            print(f"⚠ Eventstream not created ({err}).\n  Create it in the portal instead: docs/DEPLOYMENT.md, step 5.")
    else:
        print("\nEventstream: one portal step, then re-run.\n"
              f"  1. Fabric portal > workspace '{args.workspace}' > Settings > Manage connections > New: Azure Event Hubs,\n"
              f"     namespace {args.eventhub_namespace or '<namespace>'}, hub match-events, authentication: Workspace identity.\n"
              "  2. Copy the connection id, then: azd env set FABRIC_EVENTHUB_CONNECTION_ID <id> && azd provision")

    print(f"\nOneLake for the API: ONELAKE_WORKSPACE={args.workspace}  ONELAKE_LAKEHOUSE={LAKEHOUSE_NAME}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
