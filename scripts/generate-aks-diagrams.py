"""Generate docs/architecture-aks.drawio and docs/architecture-aks-enterprise.drawio (same style as architecture.drawio).

    python3 scripts/generate-aks-diagrams.py docs

Regenerating overwrites hand edits made in draw.io; edit here instead, or stop using the script once you edit by hand.
"""

import sys
from html import escape
from pathlib import Path

OUT = Path(sys.argv[1])

AZURE, GREEN, PURPLE, ORANGE, GREY, RED, TEAL = "#0078D4", "#107C10", "#7B2CBF", "#C2410C", "#666666", "#B91C1C", "#117865"


class Diagram:
    def __init__(self, name):
        self.name, self.cells, self.n = name, [], 0

    def _id(self, prefix):
        self.n += 1
        return f"{prefix}{self.n}"

    def group(self, label, x, y, w, h, stroke=AZURE, fill="#F4F9FF", parent="1", dashed=False):
        cid = self._id("g")
        style = (f"rounded=1;whiteSpace=wrap;html=1;container=1;collapsible=0;verticalAlign=top;align=left;spacingLeft=10;"
                 f"spacingTop=6;fontStyle=1;fontSize=13;arcSize=3;fillColor={fill};strokeColor={stroke};fontColor=#1A1A1A;"
                 + ("dashed=1;" if dashed else ""))
        self.cells.append(f'<mxCell id="{cid}" value="{escape(label)}" style="{style}" vertex="1" parent="{parent}">'
                          f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')
        return cid

    def box(self, title, body, x, y, w, h, stroke=AZURE, fill="#FFFFFF", parent="1", size=11):
        cid = self._id("n")
        html = f"<b>{escape(title)}</b>" + (f"<br>{body}" if body else "")
        style = f"rounded=1;whiteSpace=wrap;html=1;fontSize={size};arcSize=10;fillColor={fill};strokeColor={stroke};fontColor=#1A1A1A;"
        self.cells.append(f'<mxCell id="{cid}" value="{escape(html)}" style="{style}" vertex="1" parent="{parent}">'
                          f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')
        return cid

    def text(self, html, x, y, w, h, parent="1", size=10, color="#444444"):
        cid = self._id("t")
        style = f"text;html=1;whiteSpace=wrap;align=left;verticalAlign=top;fontSize={size};fontColor={color};"
        self.cells.append(f'<mxCell id="{cid}" value="{escape(html)}" style="{style}" vertex="1" parent="{parent}">'
                          f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')
        return cid

    def edge(self, src, tgt, label="", color="#555555", dashed=False, width=1.5):
        cid = self._id("e")
        style = (f"edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;html=1;endArrow=block;endFill=1;strokeColor={color};"
                 f"strokeWidth={width};fontSize=10;labelBackgroundColor=#FFFFFF;" + ("dashed=1;" if dashed else ""))
        self.cells.append(f'<mxCell id="{cid}" value="{escape(label)}" style="{style}" edge="1" parent="1" source="{src}" '
                          f'target="{tgt}"><mxGeometry relative="1" as="geometry"/></mxCell>')

    def write(self, path, w, h):
        xml = (f'<mxfile host="app.diagrams.net" agent="Regista" version="24.7.17">\n'
               f'<diagram id="{self.name}" name="{self.name}">\n'
               f'<mxGraphModel dx="1600" dy="1000" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" '
               f'fold="1" page="1" pageScale="1" pageWidth="{w}" pageHeight="{h}" math="0" shadow="0">\n<root>\n'
               '<mxCell id="0"/>\n<mxCell id="1" parent="0"/>\n' + "\n".join(self.cells) + "\n</root>\n</mxGraphModel>\n</diagram>\n</mxfile>\n")
        path.write_text(xml)


def shared_platform(d, parent, x0, y0, private):
    """Foundry, data services, observability: the boxes both AKS diagrams share."""
    pna = "public access <b>disabled</b> · private endpoint" if private else "public endpoint · Entra ID only (keys disabled)"
    f = d.group("Microsoft Foundry (AIServices + project)", x0, y0, 420, 200, stroke=PURPLE, fill="#FBF7FF", parent=parent)
    models = d.box("Models", "chat: gpt-5.4-mini · reasoning: gpt-5.5<br>Agent Framework agents · evaluations · tracing", 15, 38, 390, 52, PURPLE, parent=f)
    d.box("AI services", "Speech · Translator · Content Safety + Prompt Shields", 15, 98, 390, 40, PURPLE, parent=f)
    d.text(pna, 15, 148, 390, 40, parent=f)
    data = d.group("Data", x0, y0 + 215, 420, 270, stroke=GREEN, fill="#F6FBF4", parent=parent)
    eh = d.box("Event Hubs (Standard)", "match-events · consumer groups api / functions / fabric", 15, 38, 390, 45, GREEN, parent=data)
    cos = d.box("Cosmos DB (serverless)", "narratives · studio · audit · recaps · profiles", 15, 90, 390, 45, GREEN, parent=data)
    st = d.box("Storage", "datasets · audio · recaps · Functions package", 15, 142, 390, 45, GREEN, parent=data)
    fn = d.box("Azure Functions (Flex)", "full-time recap automation (Event Hubs trigger)" + (" · VNet-integrated" if private else ""), 15, 194, 390, 45, GREEN, parent=data)
    d.text(pna, 15, 244, 390, 20, parent=data)
    obs = d.group("Observability and cost", x0, y0 + 500, 420, 120, stroke=GREY, fill="#FAFAFA", parent=parent)
    la = d.box("Log Analytics + Application Insights", "OpenTelemetry (Agent Framework spans) · Container Insights" + (" · Front Door / APIM / AKS diagnostics" if private else ""), 15, 35, 390, 45, GREY, parent=obs)
    d.text("Monthly budget alert (Bicep) · SLO + cost per match at /ops", 15, 88, 390, 25, parent=obs)
    return {"models": models, "eh": eh, "cosmos": cos, "storage": st, "functions": fn, "logs": la}


def aks_standard():
    d = Diagram("Regista on AKS (standard)")
    d.text("<b style='font-size:20px'>Regista on AKS — standard profile</b><br>"
           "Public ingress through the AKS application routing add-on · keyless PaaS · deployed with <b>azd</b> "
           "(deploy/aks) from GitHub Actions or Azure Pipelines", 20, 10, 1400, 50, size=13, color="#1A1A1A")

    users = d.group("Users and clients", 20, 80, 230, 360, stroke=GREY, fill="#FFFFFF")
    fans = d.box("Fans · producers · managers", "Matchday · Studio · Dugout · Scouting", 15, 40, 200, 60, GREY, parent=users)
    ovl = d.box("Broadcast overlay", "/overlay/:id in OBS / vMix", 15, 110, 200, 50, GREY, parent=users)
    cop = d.box("GitHub Copilot · MCP clients", "/mcp (14 tools)", 15, 170, 200, 50, GREY, parent=users)

    cicd = d.group("Delivery", 20, 460, 230, 300, stroke="#24292F", fill="#FFFFFF")
    gha = d.box("GitHub Actions", "ci.yml: ruff · pytest (≥90% cov) · eval gates · Vitest · Bicep lint", 15, 40, 200, 75, "#24292F", parent=cicd)
    ado = d.box("Azure Pipelines", "azure-dev.yml: what-if → provision → deploy<br>(profile = aks) · approvals on environment", 15, 125, 200, 85, "#0062AD", parent=cicd)
    azd = d.box("azd", "deploy/aks/azure.yaml · hooks grant AKS RBAC by role name, smoke-test", 15, 220, 200, 65, "#0062AD", parent=cicd)

    az = d.group("Azure subscription (UK South) · one resource group · keyless: Entra ID + managed identities everywhere",
                 280, 80, 1400, 820)
    aks = d.group("AKS · Entra ID + Azure RBAC · local accounts disabled · workload identity · Azure CNI overlay + Cilium · "
                  "Azure Linux nodes (autoscale 1–3) · auto-upgrade patch + node image", 20, 40, 900, 470, stroke=AZURE, fill="#FFFFFF", parent=az)
    ing = d.box("Application routing add-on", "managed NGINX · public load balancer · SSE unbuffered", 20, 50, 260, 60, AZURE, fill="#EAF3FC", parent=aks)
    ns = d.group("namespace regista · NetworkPolicy: default deny; ingress → web; web → api", 20, 130, 860, 250, stroke=AZURE, fill="#F8FBFE", parent=aks, dashed=True)
    web = d.box("regista-web ×2", "React SPA on nginx (uid 101)<br>proxies /api and /mcp to the API service", 20, 40, 250, 80, AZURE, parent=ns)
    api = d.box("regista-api", "FastAPI · live engine · detectors + Grader<br>Agent Framework agents · MCP server · SSE<br>service account → workload identity", 300, 40, 270, 95, AZURE, parent=ns)
    feeder = d.box("regista-feeder (CronJob)", "suspended · run on demand<br>replays a match into Event Hubs", 600, 40, 240, 80, AZURE, parent=ns)
    d.text("Probes on /api/health · non-root · seccomp RuntimeDefault · all capabilities dropped · resource limits", 20, 150, 820, 30, parent=ns)
    ci = d.box("Container Insights", "Entra-authenticated agent → Log Analytics", 20, 395, 260, 55, GREY, parent=aks)
    d.box("Control plane", "public API server (optional authorized IP ranges) · Free or Standard tier", 300, 395, 300, 55, AZURE, parent=aks)

    ids = d.group("Identities", 20, 530, 440, 180, stroke=AZURE, fill="#FFFFFF", parent=az)
    uami = d.box("Workload identity (user-assigned)", "federated: system:serviceaccount:regista:regista-api<br>roles: OpenAI User · Cognitive Services User · Foundry User · Event Hubs · Cosmos · Blob", 15, 35, 410, 75, AZURE, parent=ids)
    d.box("Kubelet identity", "AcrPull on the registry (no pull secrets)", 15, 120, 200, 50, AZURE, parent=ids)
    d.box("Control-plane identity", "user-assigned", 225, 120, 200, 50, AZURE, parent=ids)
    acr = d.box("Azure Container Registry", "Basic · admin user disabled · AcrPush for azd", 480, 530, 300, 60, AZURE, parent=az)
    fab = d.group("Microsoft Fabric (trial or F2)", 480, 610, 440, 130, stroke=TEAL, fill="#F2FBF9", parent=az)
    es = d.box("Eventstream → Eventhouse (KQL)", "match_events · live momentum queries", 15, 35, 410, 40, TEAL, parent=fab)
    d.box("Lakehouse (OneLake)", "synthetic season + realism report · reference CSVs", 15, 80, 410, 40, TEAL, parent=fab)

    p = shared_platform(d, az, 950, 40, private=False)

    d.edge(fans, ing, "HTTP(S)")
    d.edge(ovl, ing, "SSE")
    d.edge(cop, ing, "/mcp")
    d.edge(ing, web)
    d.edge(web, api, "/api · /mcp")
    d.edge(api, p["models"], "Entra token (workload identity)", color=PURPLE)
    d.edge(api, p["cosmos"], "", color=GREEN)
    d.edge(feeder, p["eh"], "events", color=GREEN)
    d.edge(p["eh"], p["functions"], "full_time", color=GREEN)
    d.edge(p["eh"], es, "consumer group fabric", color=TEAL)
    d.edge(api, uami, "token exchange", color=AZURE, dashed=True)
    d.edge(ci, p["logs"], "", color=GREY, dashed=True)
    d.edge(azd, acr, "docker push", color="#0062AD", dashed=True)
    d.edge(azd, ing, "kubectl apply (Entra)", color="#0062AD", dashed=True)
    d.text("<b>Legend</b> — solid: runtime traffic · dashed: identity, deployment and telemetry. "
           "Same app and platform as the Container Apps profile; only the compute changes.", 20, 760, 900, 40, parent=az)
    d.write(OUT / "architecture-aks.drawio", 1720, 920)


def aks_enterprise():
    d = Diagram("Regista on AKS (enterprise)")
    d.text("<b style='font-size:20px'>Regista on AKS — enterprise profile</b><br>"
           "API Management Standard v2 is the only public endpoint → VNet integration → internal NGINX → private AKS · "
           "every PaaS service behind a private endpoint · deployed with <b>azd</b> from an in-VNet Managed DevOps Pool",
           20, 10, 1900, 55, size=13, color="#1A1A1A")

    users = d.group("Internet", 20, 90, 220, 300, stroke=GREY, fill="#FFFFFF")
    fans = d.box("Fans · producers · managers", "web app, studio, dugout", 15, 40, 190, 60, GREY, parent=users)
    ovl = d.box("Broadcast overlay", "OBS / vMix browser source", 15, 110, 190, 50, GREY, parent=users)
    cop = d.box("Partners · MCP clients", "/api · /mcp", 15, 170, 190, 50, GREY, parent=users)


    ado = d.group("Azure DevOps", 20, 430, 220, 430, stroke="#0062AD", fill="#FFFFFF")
    ci = d.box("ci.yml", "ruff · pytest ≥90% cov · eval gates (truth score, Verifier drill) · Vitest · Bicep lint", 15, 40, 190, 95, "#0062AD", parent=ado)
    prov = d.box("azure-dev.yml · Preview + Provision", "Microsoft-hosted agent · azd provision --preview, then azd provision (control plane only) · approval on environment", 15, 145, 190, 120, "#0062AD", parent=ado)
    d.box("Service connection", "workload identity federation · no secret · Contributor + RBAC Administrator on the RG", 15, 275, 190, 80, "#0062AD", parent=ado)
    d.text("Hooks: grant AKS RBAC and AcrPush by role name; smoke-test the gateway", 15, 360, 190, 60, parent=ado)

    az = d.group("Azure subscription (UK South) · keyless: Entra ID + managed identities", 600, 90, 1350, 940)
    vnet = d.group("VNet 10.40.0.0/16 · NSG on every subnet · private DNS zones linked (9)", 20, 40, 860, 875, stroke=AZURE, fill="#FFFFFF", parent=az)

    sapim = d.group("snet-apim 10.40.5.0/24 · delegated Microsoft.Web/serverFarms", 20, 40, 400, 165, stroke=ORANGE, fill="#FFF8F2", parent=vnet)
    apim = d.box("API Management Standard v2", "inbound: public gateway, HTTPS on *.azure-api.net<br>outbound: VNet integration (snet-apim)<br>policy: rate limit per client IP · SSE unbuffered", 15, 35, 370, 115, ORANGE, parent=sapim)

    sing = d.group("snet-ingress 10.40.4.0/24", 440, 40, 400, 165, stroke=AZURE, fill="#F8FBFE", parent=vnet)
    ilb = d.box("Internal NGINX (app routing add-on)", "NginxIngressController nginx-internal<br>internal load balancer · static IP <b>10.40.4.10</b>", 15, 35, 370, 80, AZURE, fill="#EAF3FC", parent=sing)
    d.text("Microsoft supports the add-on's NGINX through Nov 2026; Gateway API is the migration path.", 15, 120, 370, 35, parent=sing)

    saks = d.group("snet-aks 10.40.0.0/22 · AKS private cluster (no public FQDN) · Standard tier · Azure Policy · Entra + Azure RBAC · workload identity · CNI overlay + Cilium · nodes autoscale 2–4",
                   20, 225, 820, 300, stroke=AZURE, fill="#F8FBFE", parent=vnet)
    ns = d.group("namespace regista · NetworkPolicy default deny", 15, 55, 790, 170, stroke=AZURE, fill="#FFFFFF", parent=saks, dashed=True)
    web = d.box("regista-web ×2", "React SPA on nginx<br>→ /api, /mcp", 15, 35, 220, 70, AZURE, parent=ns)
    api = d.box("regista-api", "FastAPI · agents · detectors + Grader · MCP · SSE · workload identity", 255, 35, 280, 70, AZURE, parent=ns)
    feeder = d.box("regista-feeder (CronJob)", "on demand → Event Hubs", 555, 35, 220, 70, AZURE, parent=ns)
    d.text("non-root · seccomp · capabilities dropped · probes · limits", 15, 120, 760, 25, parent=ns)
    apisrv = d.box("Private API server", "private endpoint in snet-aks · private DNS (system)", 15, 235, 380, 50, AZURE, parent=saks)

    spe = d.group("snet-pe 10.40.6.0/24 · private endpoints", 20, 545, 820, 120, stroke=GREEN, fill="#F6FBF4", parent=vnet)
    pe_acr = d.box("ACR", "registry", 15, 35, 110, 55, GREEN, parent=spe)
    pe_st = d.box("Storage", "blob · queue · table", 135, 35, 150, 55, GREEN, parent=spe)
    pe_cos = d.box("Cosmos DB", "Sql", 295, 35, 110, 55, GREEN, parent=spe)
    pe_eh = d.box("Event Hubs", "namespace", 415, 35, 120, 55, GREEN, parent=spe)
    pe_ai = d.box("Foundry", "account (cognitive · openai · services.ai)", 545, 35, 260, 55, GREEN, parent=spe)

    sfn = d.group("snet-functions 10.40.7.0/24 · delegated Microsoft.App/environments", 20, 685, 400, 110, stroke=GREEN, fill="#F6FBF4", parent=vnet)
    fnint = d.box("Functions Flex VNet integration", "recap automation reaches Storage / Event Hubs / Cosmos privately", 15, 35, 370, 60, GREEN, parent=sfn)

    sag = d.group("snet-agents 10.40.8.0/24 · delegated Microsoft.DevOpsInfrastructure/pools", 440, 685, 400, 110, stroke="#0062AD", fill="#F2F7FC", parent=vnet)
    mdp = d.box("Managed DevOps Pool", "stateless Ubuntu 24.04 agents · scale to zero<br>azure-dev.yml <b>Deploy</b> stage: azd deploy", 15, 35, 370, 65, "#0062AD", parent=sag)

    d.text("The only inbound path is the API Management gateway; AKS, the registry and the data services have no public endpoint. "
           "No WAF in this profile: add Front Door Premium or Application Gateway WAF in front of the gateway for production.", 20, 815, 820, 40, parent=vnet)

    acr = d.box("Container Registry (Premium)", "public access disabled · AcrPull for kubelet", 900, 40, 420, 55, AZURE, parent=az)
    p = shared_platform(d, az, 900, 110, private=True)
    d.text("<b>Fabric</b>: Eventstream needs a Fabric managed private endpoint (F SKU) to read the private Event Hubs namespace; "
           "the Lakehouse season export runs from the pipeline.", 900, 740, 420, 70, parent=az)

    d.edge(fans, apim, "HTTPS")
    d.edge(ovl, apim, "SSE")
    d.edge(cop, apim, "/api · /mcp")
    d.edge(apim, ilb, "VNet integration → 10.40.4.10", color=ORANGE, width=2)
    d.edge(ilb, web)
    d.edge(web, api)
    d.edge(api, pe_ai, "", color=PURPLE)
    d.edge(api, pe_cos, "", color=GREEN)
    d.edge(feeder, pe_eh, "", color=GREEN)
    d.edge(pe_ai, p["models"], "private link", color=PURPLE, dashed=True)
    d.edge(pe_eh, p["eh"], "private link", color=GREEN, dashed=True)
    d.edge(pe_acr, acr, "private link", color=AZURE, dashed=True)
    d.edge(fnint, p["functions"], "", color=GREEN, dashed=True)
    d.edge(prov, az, "ARM (Bicep)", color="#0062AD", dashed=True)
    d.edge(mdp, apisrv, "kubectl (Entra)", color="#0062AD", dashed=True)
    d.edge(mdp, pe_acr, "docker push", color="#0062AD", dashed=True)
    d.edge(apim, p["logs"], "diagnostics", color=GREY, dashed=True)
    d.write(OUT / "architecture-aks-enterprise.drawio", 2000, 1060)


aks_standard()
aks_enterprise()
print("written")
