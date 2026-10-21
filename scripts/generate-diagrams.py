"""Generate the three architecture diagrams with official Azure icons:

    docs/architecture.drawio              Container Apps profile (default; live judge demo)
    docs/architecture-aks.drawio          AKS standard profile
    docs/architecture-aks-enterprise.drawio  AKS enterprise profile (API Management + private endpoints)

    python3 scripts/generate-diagrams.py docs [~/Dev/Icons]

The icons (Microsoft's Azure Architecture Icons, SVG) are embedded in the .drawio files as data URIs, so the
diagrams open anywhere; the icon set itself is not copied into the repository. Regenerating overwrites hand edits
made in draw.io; edit here instead, or stop using the script once you edit by hand.
"""

import base64
import sys
from html import escape
from pathlib import Path

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "docs")
ICON_DIR = Path(sys.argv[2] if len(sys.argv) > 2 else Path.home() / "Dev" / "Icons").expanduser()

ICONS = {
    "aks": "containers/10023-icon-service-Kubernetes-Services.svg",
    "netpol": "containers/032487601-icon-service-AKS-Network-Policy.svg",
    "acr": "containers/10105-icon-service-Container-Registries.svg",
    "cae": "other/02989-icon-service-Container-Apps-Environments.svg",
    "app": "other/02884-icon-service-Worker-Container-App.svg",
    "static": "web/01007-icon-service-Static-Apps.svg",
    "webpubsub": "integration/02987-icon-service-pubsub.svg",
    "apim": "integration/10042-icon-service-API-Management-Services.svg",
    "cosmos": "databases/10121-icon-service-Azure-Cosmos-DB.svg",
    "eventhubs": "analytics/00039-icon-service-Event-Hubs.svg",
    "storage": "storage/10086-icon-service-Storage-Accounts.svg",
    "functions": "compute/10029-icon-service-Function-Apps.svg",
    "foundry": "ai + machine learning/035746832-icon-service-AI-Foundry.svg",
    "models": "ai + machine learning/038470614-icon-service-Foundry-Models.svg",
    "agents": "ai + machine learning/038470523-icon-service-Foundry-Agent-Service.svg",
    "project": "ai + machine learning/036509415-icon-service-Foundry-Project.svg",
    "speech": "ai + machine learning/00797-icon-service-Speech-Services.svg",
    "translator": "ai + machine learning/00800-icon-service-Translator-Text.svg",
    "safety": "ai + machine learning/03390-icon-service-Content-Safety.svg",
    "identity": "identity/10227-icon-service-Managed-Identities.svg",
    "users": "identity/10230-icon-service-Users.svg",
    "browser": "general/10783-icon-service-Browser.svg",
    "devices": "intune/10332-icon-service-Devices.svg",
    "subscription": "general/10002-icon-service-Subscriptions.svg",
    "budget": "general/10793-icon-service-Cost-Budgets.svg",
    "loganalytics": "monitor/00009-icon-service-Log-Analytics-Workspaces.svg",
    "appinsights": "monitor/00012-icon-service-Application-Insights.svg",
    "monitor": "monitor/00001-icon-service-Monitor.svg",
    "vnet": "networking/10061-icon-service-Virtual-Networks.svg",
    "subnet": "networking/02742-icon-service-Subnet.svg",
    "lb": "networking/10062-icon-service-Load-Balancers.svg",
    "pip": "networking/10069-icon-service-Public-IP-Addresses.svg",
    "pe": "other/02579-icon-service-Private-Endpoints.svg",
    "privatelink": "networking/00427-icon-service-Private-Link.svg",
    "policy": "management + governance/10316-icon-service-Policy.svg",
    "devops": "devops/10261-icon-service-Azure-DevOps.svg",
    "mdp": "devops/03393-icon-service-Managed-DevOps-Pools.svg",
}

AZURE, GREEN, PURPLE, ORANGE, GREY, TEAL, DEVOPS, GITHUB, AMBER = (
    "#0078D4", "#107C10", "#7B2CBF", "#C2410C", "#666666", "#117865", "#0062AD", "#24292F", "#B7791F")


def icon_uri(key: str) -> str:
    data = (ICON_DIR / ICONS[key]).read_bytes()
    # draw.io's data-URI form inside a style: no ";base64", because ";" separates style keys.
    return "data:image/svg+xml," + base64.b64encode(data).decode()


class Diagram:
    def __init__(self, name):
        self.name, self.cells, self.n = name, [], 0
        self.geo = {"1": (0.0, 0.0, 0.0, 0.0)}      # absolute x, y, w, h of every vertex

    def _id(self, prefix):
        self.n += 1
        return f"{prefix}{self.n}"

    def _place(self, cid, parent, x, y, w, h):
        px, py = self.geo[parent][:2]
        self.geo[cid] = (px + x, py + y, w, h)

    def _image(self, key, x, y, size, parent):
        cid = self._id("i")
        style = f"shape=image;aspect=fixed;html=1;points=[];imageAspect=0;image={icon_uri(key)};"
        self.cells.append(f'<mxCell id="{cid}" value="" style="{style}" vertex="1" parent="{parent}">'
                          f'<mxGeometry x="{x}" y="{y}" width="{size}" height="{size}" as="geometry"/></mxCell>')
        self._place(cid, parent, x, y, size, size)

    def group(self, label, x, y, w, h, stroke=AZURE, fill="#F4F9FF", parent="1", dashed=False, icon=None):
        cid = self._id("g")
        style = (f"rounded=1;whiteSpace=wrap;html=1;container=1;collapsible=0;verticalAlign=top;align=left;"
                 f"spacingLeft={38 if icon else 10};spacingTop=8;fontStyle=1;fontSize=12;arcSize=2;fillColor={fill};"
                 f"strokeColor={stroke};fontColor=#1A1A1A;" + ("dashed=1;" if dashed else ""))
        self.cells.append(f'<mxCell id="{cid}" value="{escape(label)}" style="{style}" vertex="1" parent="{parent}">'
                          f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')
        self._place(cid, parent, x, y, w, h)
        if icon:
            self._image(icon, 8, 6, 24, cid)
        return cid

    def box(self, title, body, x, y, w, h, stroke=AZURE, fill="#FFFFFF", parent="1", icon=None, size=11, dashed=False):
        cid = self._id("n")
        html = f"<b>{escape(title)}</b>" + (f"<br>{body}" if body else "")
        style = (f"rounded=1;whiteSpace=wrap;html=1;fontSize={size};arcSize=8;fillColor={fill};strokeColor={stroke};"
                 f"fontColor=#1A1A1A;align=left;spacingLeft={50 if icon else 10};spacingRight=6;"
                 + ("dashed=1;" if dashed else ""))
        self.cells.append(f'<mxCell id="{cid}" value="{escape(html)}" style="{style}" vertex="1" parent="{parent}">'
                          f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')
        self._place(cid, parent, x, y, w, h)
        if icon:
            s = 34 if h >= 50 else 26
            self._image(icon, x + 9, y + (h - s) / 2, s, parent)
        return cid

    def text(self, html, x, y, w, h, parent="1", size=10, color="#444444"):
        cid = self._id("t")
        style = f"text;html=1;whiteSpace=wrap;align=left;verticalAlign=top;fontSize={size};fontColor={color};"
        self.cells.append(f'<mxCell id="{cid}" value="{escape(html)}" style="{style}" vertex="1" parent="{parent}">'
                          f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')
        self._place(cid, parent, x, y, w, h)
        return cid

    def edge(self, src, tgt, label="", color="#555555", dashed=False, width=1.5, exit=None, entry=None, via_x=None, via_y=None):
        """Orthogonal edge. via_x routes the vertical leg at an absolute x (a free channel between columns);
        via_y routes the horizontal leg at an absolute y."""
        cid = self._id("e")
        style = (f"edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;html=1;endArrow=block;endFill=1;"
                 f"strokeColor={color};strokeWidth={width};fontSize=10;labelBackgroundColor=#FFFFFF;"
                 + ("dashed=1;" if dashed else ""))
        if exit:
            style += f"exitX={exit[0]};exitY={exit[1]};exitDx=0;exitDy=0;"
        if entry:
            style += f"entryX={entry[0]};entryY={entry[1]};entryDx=0;entryDy=0;"
        pts = ""
        if via_x is not None or via_y is not None:
            sx, sy, sw, sh = self.geo[src]
            tx, ty, tw, th = self.geo[tgt]
            ax, ay = (sx + sw * exit[0], sy + sh * exit[1]) if exit else (sx + sw / 2, sy + sh / 2)
            bx, by = (tx + tw * entry[0], ty + th * entry[1]) if entry else (tx + tw / 2, ty + th / 2)
            points = [(via_x, ay), (via_x, by)] if via_x is not None else [(ax, via_y), (bx, via_y)]
            pts = '<Array as="points">' + "".join(f'<mxPoint x="{px}" y="{py}"/>' for px, py in points) + "</Array>"
        self.cells.append(f'<mxCell id="{cid}" value="{escape(label)}" style="{style}" edge="1" parent="1" '
                          f'source="{src}" target="{tgt}"><mxGeometry relative="1" as="geometry">{pts}</mxGeometry></mxCell>')

    def write(self, path, w, h):
        xml = (f'<mxfile host="app.diagrams.net" agent="Regista" version="24.7.17">\n'
               f'<diagram id="{self.name}" name="{self.name}">\n'
               f'<mxGraphModel dx="1600" dy="1000" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" '
               f'fold="1" page="1" pageScale="1" pageWidth="{w}" pageHeight="{h}" background="#ffffff" math="0" shadow="0">\n<root>\n'
               '<mxCell id="0"/>\n<mxCell id="1" parent="0"/>\n' + "\n".join(self.cells) + "\n</root>\n</mxGraphModel>\n</diagram>\n</mxfile>\n")
        path.write_text(xml)


def title(d, heading, sub, w):
    d.text(f"<b style='font-size:20px'>{heading}</b><br>{sub}", 20, 10, w, 55, size=13, color="#1A1A1A")


def platform(d, parent, x0, y0, w, private):
    """Foundry, data services and observability: the column both AKS diagrams share."""
    access = "public access <b>disabled</b> · reached through private endpoints" if private else "public endpoints · Entra ID only (keys disabled)"
    inner = w - 30
    f = d.group("Microsoft Foundry (AI Services + project)", x0, y0, w, 245, stroke=PURPLE, fill="#FBF7FF", parent=parent, icon="foundry")
    models = d.box("Models · Agent Framework", "chat: gpt-5.4-mini · reasoning: gpt-5.5<br>agents · evaluations · tracing", 15, 42, inner, 62, PURPLE, parent=f, icon="models")
    third = (inner - 20) / 3
    d.box("Speech", "neural TTS", 15, 114, third, 62, PURPLE, parent=f, icon="speech", size=10)
    d.box("Translator", "12 languages", 25 + third, 114, third, 62, PURPLE, parent=f, icon="translator", size=10)
    d.box("Content Safety", "+ Prompt Shields", 35 + 2 * third, 114, third, 62, PURPLE, parent=f, icon="safety", size=10)
    d.text(access, 15, 190, inner, 40, parent=f)

    data = d.group("Data and automation", x0, y0 + 265, w, 330, stroke=GREEN, fill="#F6FBF4", parent=parent)
    eh = d.box("Event Hubs (Standard)", "match-events · consumer groups api / functions / fabric", 15, 42, inner, 58, GREEN, parent=data, icon="eventhubs")
    fn = d.box("Azure Functions (Flex)", "full-time recap automation (Event Hubs trigger)" + (" · VNet-integrated" if private else ""), 15, 108, inner, 58, GREEN, parent=data, icon="functions")
    cos = d.box("Cosmos DB (serverless)", "narratives · studio · audit log · recaps · profiles", 15, 174, inner, 58, GREEN, parent=data, icon="cosmos")
    st = d.box("Storage", "datasets · audio · recaps · Functions package", 15, 240, inner, 58, GREEN, parent=data, icon="storage")
    d.text(access, 15, 303, inner, 22, parent=data)
    d.edge(eh, fn, "full_time", color=GREEN, exit=(0.5, 1), entry=(0.5, 0))

    obs = d.group("Observability and cost", x0, y0 + 615, w, 175, stroke=GREY, fill="#FAFAFA", parent=parent, icon="monitor")
    d.box("Log Analytics", "Container Insights · diagnostics" + (" · API Management, AKS" if private else ""), 15, 42, inner, 55, GREY, parent=obs, icon="loganalytics")
    half = (inner - 10) / 2
    d.box("Application Insights", "OpenTelemetry · agent spans", 15, 105, half, 55, GREY, parent=obs, icon="appinsights", size=10)
    d.box("Budget alert", "monthly, from Bicep · SLO + cost at /ops", 25 + half, 105, half, 55, GREY, parent=obs, icon="budget", size=10)
    return {"foundry": f, "models": models, "data": data, "eh": eh, "cosmos": cos, "storage": st, "functions": fn}


def users_group(d, x, y, w, enterprise=False):
    g = d.group("Internet" if enterprise else "Users and clients", x, y, w, 270, stroke=GREY, fill="#FFFFFF", icon="users")
    fans = d.box("Fans · producers · managers", "Matchday · Studio · Dugout", 12, 42, w - 24, 62, GREY, parent=g, icon="users")
    ovl = d.box("Broadcast overlay", "OBS / vMix browser source", 12, 114, w - 24, 62, GREY, parent=g, icon="browser")
    cop = d.box("Partners · MCP clients" if enterprise else "Copilot · MCP clients", "/api · /mcp" if enterprise else "/mcp (14 tools)", 12, 186, w - 24, 62, GREY, parent=g, icon="devices")
    return fans, ovl, cop


# ---------------------------------------------------------------------------------------------------------------
# Container Apps profile
# ---------------------------------------------------------------------------------------------------------------

def container_apps():
    d = Diagram("Regista on Azure Container Apps")
    title(d, "Regista: the AI that reads the game — Container Apps profile",
          "Static Web Apps (SPA) · Container Apps (API, feeder) · Microsoft Foundry · Agent Framework · MCP · Event Hubs · "
          "Functions · Cosmos DB · Microsoft Fabric · GitHub", 1900)

    users = d.group("Users and clients", 20, 90, 270, 400, stroke=GREY, fill="#FFFFFF", icon="users")
    fans = d.box("Fans", "Matchday · Ask · Recap · Scouting<br>12 languages · audio described", 12, 42, 246, 66, GREY, parent=users, icon="users")
    prod = d.box("Studio producer · Manager", "control room: approve / edit / kill<br>truth panel · Dugout", 12, 118, 246, 66, GREY, parent=users, icon="users")
    ovl = d.box("Broadcast overlay", "/overlay/:id in OBS / vMix<br>1920×1080, transparent", 12, 194, 246, 66, GREY, parent=users, icon="browser")
    cop = d.box("GitHub Copilot agent mode", ".vscode/mcp.json + Azure MCP Server", 12, 270, 246, 56, GREY, parent=users, icon="devices")
    mcp = d.box("Any MCP client", "Foundry agents · broadcaster assistants", 12, 336, 246, 52, GREY, parent=users, icon="devices")

    gh = d.group("GitHub", 20, 510, 270, 400, stroke=GITHUB, fill="#FFFFFF")
    d.box("Repository", "services/api · apps/web · infra (Bicep) · deploy (azd)", 12, 40, 246, 60, GITHUB, parent=gh)
    d.box("Actions: ci.yml", "ruff · pytest (≥ 90% coverage) · eval gates + truth score · Vitest (coverage floor) · Bicep lint", 12, 110, 246, 84, GITHUB, parent=gh)
    deploy = d.box("infra.yml · deploy.yml · evals.yml", "OIDC (no secrets) · what-if · ACR build · SPA upload to Static Web Apps · smoke tests", 12, 204, 246, 84, GITHUB, parent=gh)
    d.box("Azure DevOps (option)", "azure-dev.yml: azd what-if → provision → deploy, with approvals", 12, 298, 246, 84, DEVOPS, parent=gh, icon="devops", size=10)

    ref = d.group("Real reference data (CC0)", 20, 930, 270, 200, stroke=AMBER, fill="#FFFBEB")
    d.box("International results 1872–2026", "49,945 matches · 337 teams<br>47,914 goals (minute, pen, OG, assist)<br>martj42/international_results", 12, 40, 246, 92, AMBER, parent=ref)
    d.text("Bundled in the API image. Used for real match facts, Elo, the goal model, squads, head-to-head and the calibration backtest.", 12, 140, 246, 55, parent=ref)

    az = d.group("Azure subscription (UK South) · keyless: one user-assigned managed identity, Entra ID everywhere", 320, 90, 1760, 1040, icon="subscription")

    swa = d.box("Azure Static Web Apps (Free)", "React 19 SPA · 9 surfaces + /overlay · global, HTTPS (metadata: East US 2) · "
                "calls the API directly: fetch + SSE, CORS limited to this origin", 20, 48, 520, 60, AZURE, parent=az, icon="static", size=10)
    wps = d.box("Azure Web PubSub (Standard S1)", "shared live broadcast: the API publishes once per tick · groups match.{id} / .{lang} / overlay.{id}<br>"
                "1,000 viewers per unit, 100 units = 100,000 · keyless (Entra tokens)", 20, 118, 520, 72, AZURE, parent=az, icon="webpubsub", size=10)

    cae = d.group("Container Apps environment (consumption, KEDA autoscale)", 20, 210, 520, 400, stroke=AZURE, fill="#FFFFFF", parent=az, icon="cae")
    api = d.box("regista-api (FastAPI, Python 3.12)",
                "• Data Forge: conditioned engine + planted scenarios<br>• Analytics: xG, xT, win prob, PPDA, shapes<br>• Detectors + Grader (truth loop)<br>"
                "• Live: SSE (personal replay) + Web PubSub (shared broadcast)<br>• Agent runtime (Agent Framework) · MCP /mcp (14 tools)<br>• Scouting · Dugout · Ops (SLO, cost)<br>"
                "• Verifier + fair-commentary guardrail · CORS: SPA origin",
                15, 44, 490, 186, AZURE, parent=cae, icon="app", size=10)
    feeder = d.box("Job: regista-feeder", "replays a match into Event Hubs at real or accelerated speed", 15, 240, 490, 58, AZURE, parent=cae, icon="app")
    d.box("Container Registry", "ACR Tasks builds · AcrPull via identity", 15, 308, 240, 72, AZURE, parent=cae, icon="acr", size=10)
    d.box("Managed identity", "Entra ID · RBAC only · no keys, no connection strings", 265, 308, 240, 72, AZURE, parent=cae, icon="identity", size=10)

    d.box("Application Insights + Log Analytics", "OpenTelemetry: requests, agent spans, latency", 20, 630, 330, 64, GREY, parent=az, icon="appinsights", size=10)
    d.box("Budget alert", "monthly, from Bicep", 360, 630, 180, 64, GREY, parent=az, icon="budget", size=10)

    fdy = d.group("Microsoft Foundry (AI Services account + project)", 570, 48, 600, 352, stroke=PURPLE, fill="#FBF7FF", parent=az, icon="foundry")
    agents = d.box("Multi-agent workflows (Microsoft Agent Framework)",
                   "Detector → Analyst → Verifier (rewrite loop) → Producer → human<br>Analyst ∥ Tactician (ConcurrentBuilder) → Narrator · Localizer<br>"
                   "Ask agent uses the MCP tools · Scenario Director · Assistant Coach", 15, 42, 570, 92, PURPLE, parent=fdy, icon="agents", size=10)
    third = (570 - 20) / 3
    d.box("Model: chat", "gpt-5.4-mini · live narration", 15, 144, third, 70, PURPLE, parent=fdy, icon="models", size=10)
    d.box("Model: reasoning", "gpt-5.5 · recaps · analyst", 25 + third, 144, third, 70, PURPLE, parent=fdy, icon="models", size=10)
    d.box("Evaluations + tracing", "groundedness · nightly evals.yml", 35 + 2 * third, 144, third, 70, PURPLE, parent=fdy, icon="project", size=10)
    d.box("Speech", "neural TTS · 12 voices", 15, 224, third, 64, PURPLE, parent=fdy, icon="speech", size=10)
    d.box("Translator", "live feed localisation", 25 + third, 224, third, 64, PURPLE, parent=fdy, icon="translator", size=10)
    d.box("Content Safety", "moderation · Prompt Shields", 35 + 2 * third, 224, third, 64, PURPLE, parent=fdy, icon="safety", size=10)
    d.text("Every narrative: fact sheet → model → deterministic fact-check → Content Safety. Every number cites a fact id.", 15, 300, 570, 40, parent=fdy)

    data = d.group("Data and automation", 570, 420, 600, 330, stroke=GREEN, fill="#F6FBF4", parent=az)
    eh = d.box("Event Hubs (Standard)", "hub match-events · partition key match_id · consumer groups api / functions / fabric", 15, 42, 570, 58, GREEN, parent=data, icon="eventhubs")
    fn = d.box("Azure Functions (Flex Consumption)", "Event Hubs trigger on full_time → POST /api/recap → store the recap", 15, 108, 570, 58, GREEN, parent=data, icon="functions")
    cos = d.box("Cosmos DB for NoSQL (serverless)", "narratives · recaps · studio · audit log · matches · profiles", 15, 174, 570, 58, GREEN, parent=data, icon="cosmos")
    d.box("Blob Storage", "datasets · audio (TTS mp3) · recaps · Functions package", 15, 240, 570, 58, GREEN, parent=data, icon="storage")
    d.text("Entra ID only: local and key auth disabled", 15, 303, 570, 22, parent=data)

    fab = d.group("Microsoft Fabric (trial or F2)", 1200, 48, 540, 330, stroke=TEAL, fill="#F2FBF9", parent=az)
    es = d.box("Eventstream", "source: Event Hubs (consumer group fabric)", 15, 42, 250, 70, TEAL, parent=fab)
    d.box("Eventhouse · KQL DB", "match_events · live momentum and latency KQL", 275, 42, 250, 70, TEAL, parent=fab)
    d.box("Lakehouse (OneLake)", "Files/regista/matches/* (Data Forge exports) · season dataset · reference CSVs", 15, 122, 510, 70, TEAL, parent=fab)
    d.box("Fabric data agent (optional, F2+)", "NL → SQL over 150 years of results, exposed to Foundry agents", 15, 202, 510, 66, TEAL, parent=fab, dashed=True)
    d.text("Fabric works on a trial capacity; the app runs without it.", 15, 280, 510, 30, parent=fab)

    d.text("<b>Legend</b> — solid: runtime traffic · dashed: deployment. All Azure calls use Entra ID tokens via the managed identity; "
           "no keys or connection strings anywhere.", 1200, 400, 540, 50, parent=az)
    d.text("<b>Evaluation results (CI gate, fresh seeds)</b><br>Truth score: recall 41% · 0.92 false alarms/match · explanations 100% · "
           "Verifier drill 495/495<br>Grounding 100% · real-result fidelity 100% · calibration 16/16 · Brier 0.469 · shape precision 67%",
           1200, 465, 540, 80, parent=az)

    loop = d.group("Truth loop (hidden from every agent): code detects, AI explains, the Grader keeps score", 20, 780, 1720, 150,
                   stroke=ORANGE, fill="#FFF7ED", parent=az)
    steps = [("1 · Plant", "scenario scripts move a team's knobs at an exact minute; hidden labels"),
             ("2 · Detect", "per-minute features + two-segment change point (≈ KQL series_fit_2lines)"),
             ("3 · Explain + verify", "Analyst writes from fields; Verifier re-checks numbers; drill plants claim errors"),
             ("4 · Approve", "Producer proposes a cue; human approve / edit / kill; audit log"),
             ("5 · Grade", "Grader vs hidden labels: detected, seconds to detect, explanation, false alarms"),
             ("6 · Measure + gate", "counterfactual re-runs; truth score in CI blocks regressions")]
    sw = (1720 - 30 - 5 * 22) / 6
    ids = [d.box(t, b, 15 + i * (sw + 22), 44, sw, 88, ORANGE, parent=loop, size=10) for i, (t, b) in enumerate(steps)]
    for a, b in zip(ids, ids[1:]):
        d.edge(a, b, "", color=ORANGE, exit=(1, 0.5), entry=(0, 0.5))

    # Edges: browser -> SPA and browser -> API, then the runtime flows through the free channel between columns.
    gap_x = d.geo[cae][0] + 520 + 15            # channel between the Container Apps column and the Foundry/Data column
    # One lane per edge in the gap between the users column and the subscription, so vertical legs never overlap.
    d.edge(fans, swa, "SPA (HTTPS)", exit=(1, 0.25), entry=(0, 0.35), via_x=296)
    d.edge(prod, swa, "", exit=(1, 0.3), entry=(0, 0.7), via_x=302)
    d.edge(fans, wps, "WebSocket", exit=(1, 0.5), entry=(0, 0.35), via_x=308)
    d.edge(ovl, wps, "", exit=(1, 0.3), entry=(0, 0.7), via_x=314)
    d.edge(fans, api, "/api · SSE (CORS)", exit=(1, 0.75), entry=(0, 0.2), via_x=320)
    d.edge(ovl, api, "", exit=(1, 0.6), entry=(0, 0.45), via_x=326)
    d.edge(cop, api, "/mcp", exit=(1, 0.5), entry=(0, 0.7), via_x=332)
    d.edge(mcp, api, "", exit=(1, 0.5), entry=(0, 0.9), via_x=337)
    # API -> Web PubSub: straight up at the right edge of the column, clear of the environment's title.
    d.edge(api, wps, "", exit=(0.97, 0), entry=(0.95, 1))
    d.edge(api, agents, "Entra token", color=PURPLE, exit=(1, 0.12), entry=(0, 0.5), via_x=gap_x - 5)
    d.edge(api, cos, "", color=GREEN, exit=(1, 0.85), entry=(0, 0.5), via_x=gap_x - 10)
    d.edge(feeder, eh, "events", color=GREEN, exit=(1, 0.5), entry=(0, 0.5), via_x=gap_x + 5)
    d.edge(eh, fn, "full_time", color=GREEN, exit=(0.5, 1), entry=(0.5, 0))
    d.edge(eh, es, "consumer group fabric", color=TEAL, exit=(1, 0.5), entry=(0, 0.5), via_x=d.geo[fab][0] - 15)
    d.edge(deploy, az, "OIDC: Bicep, images, SPA", color=GITHUB, dashed=True, exit=(1, 0.5), entry=(0, 0.69))
    d.write(OUT / "architecture.drawio", 2100, 1150)


# ---------------------------------------------------------------------------------------------------------------
# AKS standard profile
# ---------------------------------------------------------------------------------------------------------------

def aks_standard():
    d = Diagram("Regista on AKS (standard)")
    title(d, "Regista on AKS — standard profile",
          "SPA on Static Web Apps · API on AKS behind a public NGINX ingress with HTTPS (cert-manager + Let's Encrypt) · keyless PaaS · "
          "deployed with <b>azd</b> (deploy/aks) from GitHub Actions or Azure Pipelines", 1700)

    fans, ovl, cop = users_group(d, 20, 90, 250)

    cicd = d.group("Delivery", 20, 390, 250, 330, stroke=DEVOPS, fill="#FFFFFF", icon="devops")
    d.box("GitHub Actions", "ci.yml: ruff · pytest (≥90% cov) · eval gates · Vitest · Bicep lint", 12, 42, 226, 80, GITHUB, parent=cicd)
    d.box("Azure Pipelines", "azure-dev.yml: what-if → provision → deploy (profile = aks) · approvals", 12, 132, 226, 80, DEVOPS, parent=cicd, icon="devops")
    azd = d.box("azd", "deploy/aks/azure.yaml · hooks install cert-manager, grant AKS RBAC by role name, smoke-test", 12, 222, 226, 92, DEVOPS, parent=cicd)

    az = d.group("Azure subscription (UK South) · one resource group · keyless: Entra ID + managed identities everywhere",
                 300, 90, 1450, 925, icon="subscription")

    swa = d.box("Azure Static Web Apps (Free)", "React SPA + /overlay · global, HTTPS (metadata: East US 2) · the browser calls the API directly: fetch + SSE, CORS limited to this origin",
                20, 48, 900, 56, AZURE, parent=az, icon="static", size=10)
    wps = d.box("Azure Web PubSub (Standard S1)", "shared live broadcast: the API publishes once per tick · groups match.{id} / .{lang} / overlay.{id} · "
                "1,000 viewers per unit, 100 units = 100,000 · keyless (Entra tokens)", 20, 114, 900, 60, AZURE, parent=az, icon="webpubsub", size=10)

    aks = d.group("AKS · public API server (Entra ID only, optional authorized IPs) · Free or Standard tier", 20, 194, 900, 424,
                  stroke=AZURE, fill="#FFFFFF", parent=az, icon="aks")
    d.text("local accounts disabled · Azure RBAC · workload identity · Azure CNI overlay + Cilium · Azure Linux nodes autoscale 1–3 · "
           "automatic patch + node-image upgrades", 15, 34, 870, 20, parent=aks)
    ing = d.box("Public NGINX (app routing) · nginx-public", "static public IP with a DNS label · HTTPS: cert-manager + Let's Encrypt · SSE unbuffered",
                450, 62, 435, 66, AZURE, fill="#EAF3FC", parent=aks, icon="pip")
    ns = d.group("namespace regista · NetworkPolicy: default deny; NGINX → api", 15, 146, 870, 186, stroke=AZURE, fill="#F8FBFE",
                 parent=aks, dashed=True, icon="netpol")
    d.text("probes on /api/health · non-root · seccomp RuntimeDefault · capabilities dropped · resource limits · one API replica "
           "(live state is in memory)", 15, 50, 390, 60, parent=ns)
    api = d.box("regista-api", "FastAPI · detectors + Grader · Agent Framework · MCP · SSE replay + Web PubSub broadcast · workload identity",
                435, 44, 420, 72, AZURE, parent=ns, size=10)
    feeder = d.box("regista-feeder (CronJob)", "suspended · run on demand · replays a match into Event Hubs", 435, 124, 420, 50, AZURE, parent=ns, size=10)
    d.box("Container Insights", "Entra-authenticated agent → Log Analytics", 15, 348, 420, 60, GREY, parent=aks, icon="monitor")
    d.box("Kubelet identity", "AcrPull on the registry (no pull secrets)", 450, 348, 435, 60, AZURE, parent=aks, icon="identity")

    acr = d.box("Container Registry (Basic)", "admin user disabled · AcrPush for azd", 20, 638, 440, 66, AZURE, parent=az, icon="acr")
    d.box("Workload identity (user-assigned)", "federated: system:serviceaccount:regista:regista-api<br>Foundry · Event Hubs · Cosmos DB · Storage · Web PubSub roles",
          480, 638, 440, 66, AZURE, parent=az, icon="identity", size=10)
    fab = d.group("Microsoft Fabric (trial or F2)", 20, 724, 900, 130, stroke=TEAL, fill="#F2FBF9", parent=az)
    d.box("Eventstream → Eventhouse (KQL)", "reads match-events (consumer group fabric) · live momentum queries", 15, 42, 425, 70, TEAL, parent=fab)
    d.box("Lakehouse (OneLake)", "synthetic season + realism report · reference CSVs", 460, 42, 425, 70, TEAL, parent=fab)
    d.text("<b>Legend</b> — solid: runtime traffic · dashed: deployment. Same app and platform as the Container Apps "
           "profile; only the compute changes.", 20, 872, 900, 40, parent=az)

    p = platform(d, az, 945, 48, 485, private=False)

    gap_x = d.geo[aks][0] + 900 + 12          # channel between the AKS column and the platform column
    d.edge(fans, swa, "SPA (HTTPS)", exit=(1, 0.25), entry=(0, 0.5), via_x=276)
    d.edge(fans, wps, "WebSocket", exit=(1, 0.45), entry=(0, 0.35), via_x=283)
    d.edge(ovl, wps, "", exit=(1, 0.3), entry=(0, 0.7), via_x=290)
    d.edge(fans, ing, "/api · SSE (CORS)", exit=(1, 0.75), entry=(0, 0.4), via_x=297)
    d.edge(ovl, ing, "", exit=(1, 0.6), entry=(0, 0.6), via_x=304)
    d.edge(cop, ing, "/mcp", exit=(1, 0.5), entry=(0, 0.8), via_x=311)
    d.edge(ing, api, "HTTPS → :8000", exit=(0.5, 1), entry=(0.5, 0))
    d.edge(api, p["models"], "Entra token", color=PURPLE, exit=(1, 0.25), entry=(0, 0.5), via_x=gap_x - 4)
    d.edge(api, p["cosmos"], "", color=GREEN, exit=(1, 0.75), entry=(0, 0.5), via_x=gap_x + 4)
    d.edge(feeder, p["eh"], "events", color=GREEN, exit=(1, 0.5), entry=(0, 0.5), via_x=gap_x)
    # API -> Web PubSub up the channel on the right, so it never crosses the ingress box above the API.
    d.edge(api, wps, "", color=AZURE, exit=(1, 0.15), entry=(1, 0.5), via_x=gap_x + 8)
    d.edge(azd, acr, "docker push", color=DEVOPS, dashed=True, exit=(1, 0.3), entry=(0, 0.5))
    d.edge(azd, aks, "kubectl apply (Entra)", color=DEVOPS, dashed=True, exit=(1, 0.7), entry=(0, 0.95))
    d.write(OUT / "architecture-aks.drawio", 1780, 1035)


# ---------------------------------------------------------------------------------------------------------------
# AKS enterprise profile
# ---------------------------------------------------------------------------------------------------------------

def aks_enterprise():
    d = Diagram("Regista on AKS (enterprise)")
    title(d, "Regista on AKS — enterprise profile",
          "SPA on Static Web Apps (Free) · API Management Standard v2 is the API's only public endpoint → VNet integration → "
          "internal NGINX → private AKS · every PaaS service behind a private endpoint · deployed with <b>azd</b> from an in-VNet Managed DevOps Pool",
          2000)

    fans, ovl, cop = users_group(d, 20, 90, 250, enterprise=True)

    ado = d.group("Azure DevOps", 20, 390, 250, 470, stroke=DEVOPS, fill="#FFFFFF", icon="devops")
    d.box("ci.yml", "ruff · pytest ≥90% cov · eval gates (truth score, Verifier drill) · Vitest · Bicep lint", 12, 42, 226, 92, DEVOPS, parent=ado)
    prov = d.box("azure-dev.yml · Preview + Provision", "Microsoft-hosted agent · azd provision --preview, then azd provision (control plane only) · approval on the environment",
                 12, 144, 226, 118, DEVOPS, parent=ado)
    d.box("Service connection", "workload identity federation · no secret · Contributor + RBAC Administrator on the resource group", 12, 272, 226, 104, DEVOPS, parent=ado, icon="identity", size=10)
    d.text("Hooks grant AKS RBAC and AcrPush by role name and smoke-test the gateway.", 12, 386, 226, 50, parent=ado)

    az = d.group("Azure subscription (UK South) · keyless: Entra ID + managed identities", 300, 90, 1760, 1181, icon="subscription")
    swa = d.box("Azure Static Web Apps (Free)", "React SPA + /overlay · global, HTTPS (metadata: East US 2) · the browser calls the API Management gateway directly: fetch + SSE, CORS limited to this origin",
                20, 48, 1110, 56, AZURE, parent=az, icon="static", size=10)
    wps = d.box("Azure Web PubSub (Standard S1)", "shared live broadcast: the API publishes once per tick · groups match.{id} / .{lang} / overlay.{id} · 1,000 viewers per unit, "
                "100 units = 100,000<br>keyless (Entra tokens) · public: client connections only · the API publishes via its private endpoint",
                20, 114, 1110, 62, AZURE, parent=az, icon="webpubsub", size=10)
    vnet = d.group("VNet 10.40.0.0/16 · NSG on every subnet · 10 private DNS zones linked", 20, 194, 1110, 965, stroke=AZURE, fill="#FFFFFF",
                   parent=az, icon="vnet")

    sapim = d.group("snet-apim 10.40.5.0/24 · delegated Microsoft.Web/serverFarms", 20, 48, 525, 190, stroke=ORANGE, fill="#FFF8F2", parent=vnet, icon="subnet")
    apim = d.box("API Management Standard v2", "the API's only public endpoint: gateway, HTTPS on *.azure-api.net<br>outbound: VNet integration into this subnet<br>policy: rate limit per client IP · SSE unbuffered",
                 15, 44, 495, 128, ORANGE, parent=sapim, icon="apim")
    sing = d.group("snet-ingress 10.40.4.0/24", 565, 48, 525, 190, stroke=AZURE, fill="#F8FBFE", parent=vnet, icon="subnet")
    ilb = d.box("Internal NGINX (app routing add-on)", "NginxIngressController nginx-internal<br>internal load balancer · static IP <b>10.40.4.10</b>", 15, 44, 495, 80, AZURE, fill="#EAF3FC", parent=sing, icon="lb")
    d.text("Microsoft supports the add-on's NGINX through Nov 2026; Gateway API is the migration path.", 15, 132, 215, 55, parent=sing)

    saks = d.group("snet-aks 10.40.0.0/22 · AKS private cluster (no public FQDN)", 20, 258, 1070, 318, stroke=AZURE, fill="#F8FBFE", parent=vnet, icon="aks")
    d.text("Standard tier · Entra ID + Azure RBAC · local accounts disabled · workload identity · CNI overlay + Cilium · nodes autoscale 2–4",
           15, 34, 1040, 20, parent=saks)
    # Control-plane row first, left of the ingress edge, so pod -> private endpoint edges run straight down.
    d.box("Workload identity", "federated user-assigned identity", 15, 62, 225, 56, AZURE, parent=saks, icon="identity", size=10)
    d.box("Azure Policy", "+ Container Insights", 250, 62, 205, 56, GREY, parent=saks, icon="policy", size=10)
    d.box("Private API server", "private endpoint · private DNS", 465, 62, 230, 56, AZURE, parent=saks, icon="privatelink", size=10)
    ns = d.group("namespace regista · NetworkPolicy: default deny; NGINX → api", 15, 130, 1040, 172, stroke=AZURE, fill="#FFFFFF",
                 parent=saks, dashed=True, icon="netpol")
    feeder = d.box("regista-feeder (CronJob)", "on demand · replays a match into Event Hubs", 15, 44, 480, 96, AZURE, parent=ns)
    api = d.box("regista-api", "FastAPI · agents · detectors + Grader · MCP · SSE replay + Web PubSub broadcast · workload identity · CORS: SPA origin<br>"
                "non-root · seccomp · capabilities dropped · probes · limits", 515, 44, 510, 96, AZURE, parent=ns, size=10)

    spe = d.group("snet-pe 10.40.6.0/24 · private endpoints", 20, 596, 1070, 140, stroke=GREEN, fill="#F6FBF4",
                  parent=vnet, icon="pe")
    pw = (1070 - 30 - 5 * 12) / 6          # six private endpoints in one row
    # Event Hubs sits third, right of the subnet title, so the feeder's edge drops onto it without crossing text.
    d.box("Container Registry", "registry (Premium)", 15, 44, pw, 74, GREEN, parent=spe, icon="acr", size=10)
    d.box("Storage", "blob · queue · table", 15 + (pw + 12), 44, pw, 74, GREEN, parent=spe, icon="storage", size=10)
    pe_eh = d.box("Event Hubs", "namespace", 15 + 2 * (pw + 12), 44, pw, 74, GREEN, parent=spe, icon="eventhubs", size=10)
    pe_cos = d.box("Cosmos DB", "Sql", 15 + 3 * (pw + 12), 44, pw, 74, GREEN, parent=spe, icon="cosmos", size=10)
    pe_ai = d.box("Foundry", "account · 3 DNS zones", 15 + 4 * (pw + 12), 44, pw, 74, GREEN, parent=spe, icon="foundry", size=10)
    pe_wps = d.box("Web PubSub", "webpubsub · server traffic", 15 + 5 * (pw + 12), 44, pw, 74, GREEN, parent=spe, icon="webpubsub", size=10)

    sfn = d.group("snet-functions 10.40.7.0/24", 20, 756, 525, 140, stroke=GREEN, fill="#F6FBF4", parent=vnet, icon="subnet")
    d.box("Functions Flex VNet integration", "delegated Microsoft.App/environments<br>recaps reach Storage, Event Hubs and Cosmos DB privately", 15, 44, 495, 80, GREEN, parent=sfn, icon="functions")
    sag = d.group("snet-agents 10.40.8.0/24", 565, 756, 525, 140, stroke=DEVOPS, fill="#F2F7FC", parent=vnet, icon="subnet")
    mdp = d.box("Managed DevOps Pool", "delegated Microsoft.DevOpsInfrastructure/pools · scale to zero<br>runs azd deploy: the only place that reaches the private API server and registry",
                15, 44, 495, 80, DEVOPS, parent=sag, icon="mdp")
    d.text("The only inbound path to the API is the API Management gateway: AKS, the registry and the data services have no public endpoint. "
           "No WAF in this profile; Front Door Premium + WAF is the documented next step (docs/ARCHITECTURE.md).", 20, 910, 1070, 45, parent=vnet)

    p = platform(d, az, 1155, 48, 585, private=True)
    d.text("<b>Fabric</b> (no icon in the Azure set): Eventstream needs a Fabric managed private endpoint (F SKU) to read the private "
           "Event Hubs namespace; the Lakehouse season export runs from the pipeline.", 1155, 860, 585, 60, parent=az)

    d.edge(fans, swa, "SPA (HTTPS)", exit=(1, 0.25), entry=(0, 0.5), via_x=278)
    d.edge(fans, wps, "WebSocket", exit=(1, 0.45), entry=(0, 0.35), via_x=285)
    d.edge(ovl, wps, "", exit=(1, 0.3), entry=(0, 0.7), via_x=292)
    d.edge(fans, apim, "/api · SSE (CORS)", exit=(1, 0.75), entry=(0, 0.3), via_x=299)
    d.edge(ovl, apim, "", exit=(1, 0.6), entry=(0, 0.55), via_x=306)
    d.edge(cop, apim, "/api · /mcp", exit=(1, 0.5), entry=(0, 0.8), via_x=313)
    d.edge(apim, ilb, "VNet integration", color=ORANGE, width=2, exit=(1, 0.4), entry=(0, 0.5))
    d.edge(ilb, api, "", exit=(0.5, 1), entry=(0.55, 0))
    def straight_down(src, tgt):
        """Exit point on src's bottom edge directly above tgt's centre, so the edge drops vertically."""
        sx, _, sw, _ = d.geo[src]
        tx, _, tw, _ = d.geo[tgt]
        return (round((tx + tw / 2 - sx) / sw, 3), 1)

    d.edge(api, pe_cos, "", color=GREEN, exit=straight_down(api, pe_cos), entry=(0.5, 0))
    d.edge(api, pe_ai, "", color=PURPLE, exit=straight_down(api, pe_ai), entry=(0.5, 0))
    d.edge(api, pe_wps, "publish", color=AZURE, exit=straight_down(api, pe_wps), entry=(0.5, 0))
    d.edge(feeder, pe_eh, "", color=GREEN, exit=straight_down(feeder, pe_eh), entry=(0.5, 0))
    d.edge(spe, p["data"], "private link", color=GREEN, dashed=True, exit=(1, 0.5), entry=(0, 0.6))
    d.edge(mdp, spe, "docker push · kubectl (private)", color=DEVOPS, dashed=True, exit=(0.5, 0), entry=(0.75, 1))
    d.edge(prov, az, "ARM (Bicep)", color=DEVOPS, dashed=True, exit=(1, 0.5), entry=(0, 0.4))
    d.write(OUT / "architecture-aks-enterprise.drawio", 2080, 1295)


container_apps()
aks_standard()
aks_enterprise()
print("written")
