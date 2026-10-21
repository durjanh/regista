"""Producer agent for the studio: turns detected moments into broadcast graphics proposals with a human approval step.

Graphics are machine-readable (template + payload + timing) so any overlay renderer (our /overlay page, OBS, vMix,
a CG system) can draw them in sync with the feed. Nothing goes on air without a producer's approval.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from uuid import uuid4

from ..store import store

_items: dict[str, dict[str, dict]] = {}          # match_id -> item_id -> item
_overlay_subscribers: dict[str, set[asyncio.Queue]] = {}


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _clock(m: dict) -> str:
    return f"{m['minute']}+{m['added_minute']}'" if m.get("added_minute") else f"{m['minute']}'"


def items_for_moment(meta: dict, m: dict) -> list[dict]:
    names = {meta["home"]["team_id"]: meta["home"], meta["away"]["team_id"]: meta["away"]}
    team = names.get(m.get("team_id"), meta["home"])
    base = {"match_id": meta["match_id"], "moment_id": m["id"], "t": m["t"], "minute": m["minute"], "created_at": _now(), "status": "proposed"}
    ev = {e["label"]: e["value"] for e in m["evidence"]}
    out = []
    if m["type"] == "goal":
        out.append({**base, "id": f"si-lt-{m['id']}", "kind": "lower_third", "priority": m["importance"], "duration_s": 8,
                    "title": m["title"].replace("GOAL: ", ""), "body": f"{team['name']} · {ev.get('Score after the goal', '')}",
                    "data": {"template": "goal_lower_third", "team": team["name"], "colors": team["colors"],
                             "score": ev.get("Score after the goal"), "assist": ev.get("Assist"), "minute": _clock(m)}})
        side = "home" if m["team_id"] == meta["home"]["team_id"] else "away"
        if m.get("wp_before") and m.get("wp_after"):
            out.append({**base, "id": f"si-wp-{m['id']}", "kind": "stat_card", "priority": m["importance"] - 5, "duration_s": 10,
                        "title": "Win probability swing", "body": f"{team['name']}: {round(m['wp_before'][side] * 100)}% → {round(m['wp_after'][side] * 100)}%",
                        "data": {"template": "wp_swing", "team": team["name"], "colors": team["colors"],
                                 "before": m["wp_before"][side], "after": m["wp_after"][side], "xg": m.get("xg")}})
        out.append({**base, "id": f"si-rp-{m['id']}", "kind": "replay_cue", "priority": m["importance"] - 10, "duration_s": 6,
                    "title": f"Replay: {m['title']}", "body": f"Build-up of {ev.get('Passes in the move', '?')} passes, {m.get('xg', 0):.2f} xG",
                    "data": {"template": "replay_cue", "event_ids": m["event_ids"][-8:]}})
    elif m["type"] in ("big_chance", "save"):
        out.append({**base, "id": f"si-xg-{m['id']}", "kind": "stat_card", "priority": m["importance"], "duration_s": 8,
                    "title": "Chance quality", "body": f"{m['title']}: {m.get('xg', 0):.2f} xG",
                    "data": {"template": "xg_card", "team": team["name"], "colors": team["colors"], "xg": m.get("xg")}})
    elif m["type"] == "tactical_shift":
        out.append({**base, "id": f"si-tp-{m['id']}", "kind": "talking_point", "priority": m["importance"], "duration_s": 12,
                    "title": m["title"], "body": m["summary"],
                    "data": {"template": "shape_change", "team": team["name"], "colors": team["colors"],
                             "from": ev.get("Shape before"), "to": ev.get("Shape after")}})
    elif m["type"] == "momentum_swing":
        out.append({**base, "id": f"si-mo-{m['id']}", "kind": "talking_point", "priority": m["importance"], "duration_s": 10,
                    "title": m["title"], "body": m["summary"],
                    "data": {"template": "momentum", "team": team["name"], "colors": team["colors"], "shots": ev.get("Shots in the spell")}})
    elif m["type"] in ("red_card", "penalty"):
        out.append({**base, "id": f"si-al-{m['id']}", "kind": "score_bug_alert", "priority": m["importance"], "duration_s": 6,
                    "title": m["title"], "body": m["summary"], "data": {"template": "alert", "team": team["name"], "colors": team["colors"]}})
    return out


def kickoff_items(meta: dict) -> list[dict]:
    """Real-data graphics available from kick-off (head-to-head and Elo from 150 years of results)."""
    out = []
    h2h = meta.get("h2h") or {}
    base = {"match_id": meta["match_id"], "t": 0.0, "minute": 1, "created_at": _now(), "status": "proposed"}
    if h2h.get("played"):
        out.append({**base, "id": "si-h2h", "kind": "stat_card", "priority": 60, "duration_s": 12,
                    "title": "Head to head (real results)",
                    "body": f"{meta['home']['short']} {h2h['home_wins']} · Draws {h2h['draws']} · {meta['away']['short']} {h2h['away_wins']} ({h2h['played']} meetings)",
                    "data": {"template": "h2h", "real": True, **h2h, "home": meta["home"]["name"], "away": meta["away"]["name"]}})
    if meta.get("elo"):
        out.append({**base, "id": "si-elo", "kind": "stat_card", "priority": 50, "duration_s": 10,
                    "title": "Pre-match Elo (from every result since 1872)",
                    "body": f"{meta['home']['name']} {meta['elo']['home']} · {meta['away']['name']} {meta['elo']['away']}",
                    "data": {"template": "elo", "real": True, **meta["elo"]}})
    return out


# ------------------------------------------------------------------ governance: profiles, cues, editorial rules, audit

PROFILES = [
    {"id": "global-en", "name": "Global (English)", "languages": ["en"], "tone": "neutral, broadcast", "brand": {"primary": "#0B1F3A", "secondary": "#22C55E"}, "auto_approve_threshold": None},
    {"id": "uk-multi", "name": "UK + Europe (EN / FR / ES)", "languages": ["en", "fr", "es"], "tone": "warm, expert", "brand": {"primary": "#1D3557", "secondary": "#F2A900"}, "auto_approve_threshold": 85},
    {"id": "latam-es", "name": "LatAm (Spanish)", "languages": ["es", "pt"], "tone": "passionate", "brand": {"primary": "#7A263A", "secondary": "#8ECAE6"}, "auto_approve_threshold": None},
    {"id": "mena-ar", "name": "MENA (Arabic / English)", "languages": ["ar", "en"], "tone": "measured", "brand": {"primary": "#006C35", "secondary": "#FFFFFF"}, "auto_approve_threshold": 90},
]
_settings: dict[str, dict] = {}
_audit: dict[str, list[dict]] = {}
BANNED = [r"\bodds\b", r"\bbet(s|ting)?\b", r"\bwager", r"\baccumulator", r"\bbookies?\b", r"\bpunters?\b", r"\bdisgrace",
          r"\bpathetic\b", r"\brobbed\b", r"\bcheat(s|ed|ing)?\b"]


def settings_for(match_id: str) -> dict:
    return _settings.setdefault(match_id, {"profile_id": "global-en", "auto_approve_threshold": None})


def update_settings(match_id: str, profile_id: str | None, threshold: float | None, clear_threshold: bool = False) -> dict:
    st = settings_for(match_id)
    if profile_id:
        prof = next((p for p in PROFILES if p["id"] == profile_id), None)
        if not prof:
            raise KeyError(profile_id)
        st["profile_id"] = profile_id
        if prof["auto_approve_threshold"] is not None and threshold is None and not clear_threshold:
            st["auto_approve_threshold"] = prof["auto_approve_threshold"]
    if threshold is not None or clear_threshold:
        st["auto_approve_threshold"] = None if clear_threshold else max(0.0, min(100.0, threshold))
    audit(match_id, "-", "settings", "producer", "Control-room settings", f"profile {st['profile_id']}, auto-approve {st['auto_approve_threshold']}")
    return st


def audit(match_id: str, item_id: str, action: str, by: str, title: str, detail: str | None = None) -> None:
    entry = {"at": _now(), "item_id": item_id, "action": action, "by": by, "title": title}
    if detail:
        entry["detail"] = detail
    _audit.setdefault(match_id, []).append(entry)
    try:
        from ..integrations import persistence
        persistence.save("studio", {"id": f"audit-{match_id}-{len(_audit[match_id])}", "match_id": match_id, "kind": "audit", **entry})
    except Exception:
        pass


def audit_log(match_id: str) -> list[dict]:
    return list(reversed(_audit.get(match_id, [])))


def editorial(item: dict) -> dict:
    import re
    text = f"{item['title']} {item['body']}".lower()
    issues = [f"Editorial rule: '{re.sub(r'[^a-z ]', '', pat)}' language is not allowed on air" for pat in BANNED if re.search(pat, text)]
    return {"passed": not issues, "issues": issues}


def _timecode(t: float) -> str:
    s = int(max(0, t))
    return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}"


def attach_cue(match_id: str, item: dict) -> dict:
    """Versioned, machine-readable cue: any overlay renderer (ours, OBS, vMix, a CG system) can draw it.
    Data-only fields render instantly even when AI text or translation is slow or down."""
    prof = next(p for p in PROFILES if p["id"] == settings_for(match_id)["profile_id"])
    item["cue"] = {"version": "1.0", "timecode": _timecode(item["t"]), "duration_s": item["duration_s"], "priority": item["priority"],
                   "template": item["data"].get("template", item["kind"]), "data": item["data"],
                   "strings": {"en": {"title": item["title"], "body": item["body"]}}, "languages": prof["languages"]}
    item["editorial"] = editorial(item)
    return item


async def translate_cue(item: dict) -> dict:
    """Fill the profile's other languages with Azure Translator (best effort; English always present)."""
    from .services import translate
    langs = [lang for lang in item["cue"].get("languages", []) if lang != "en" and lang not in item["cue"]["strings"]]
    for lang in langs:
        try:
            title, body = await translate([item["title"], item["body"]], lang)
            item["cue"]["strings"][lang] = {"title": title, "body": body}
        except Exception:
            break
    return item


def _auto_approve(match_id: str, item: dict) -> None:
    th = settings_for(match_id).get("auto_approve_threshold")
    if th is not None and item["status"] == "proposed" and item["priority"] >= th and item["editorial"]["passed"]:
        item["status"] = "approved"
        item["auto_approved"] = True
        audit(match_id, item["id"], "approve", "auto", item["title"], f"priority {item['priority']} >= threshold {th}")


def _register(match_id: str, items: list[dict]) -> list[dict]:
    bucket = _items.setdefault(match_id, {})
    new = []
    for it in items:
        if it["id"] in bucket:
            continue
        attach_cue(match_id, it)
        bucket[it["id"]] = it
        audit(match_id, it["id"], "proposed", "system", it["title"])
        _auto_approve(match_id, it)
        new.append(it)
    return new


def items_for_insight(meta: dict, ins: dict) -> list[dict]:
    team = meta["home"] if ins["team_id"] == meta["home"]["team_id"] else meta["away"] if ins["team_id"] == meta["away"]["team_id"] else meta["home"]
    return [{"id": f"si-in-{ins['id']}", "match_id": meta["match_id"], "moment_id": None, "insight_id": ins["id"], "t": ins["detected_t"],
             "minute": ins["detected_minute"], "created_at": _now(), "status": "proposed", "kind": "lower_third",
             "priority": int(min(95, 55 + 40 * ins["confidence"])), "duration_s": 10, "title": ins["title"], "body": ins["text"],
             "data": {"template": "tactical_insight", "team": team["name"], "colors": team["colors"], "mechanism": ins["mechanism"],
                      "before": ins["feature"]["before"], "after": ins["feature"]["after"], "label": ins["feature"]["label"],
                      "change_minute": ins["feature"]["change_minute"]}}]


def propose(match_id: str, upto_t: float | None = None) -> list[dict]:
    an = store.analyzer(match_id)
    analysis = an.analyze(upto_t)
    items = list(kickoff_items(an.meta))
    for m in analysis["moments"]:
        if m["type"] != "turning_point":
            items += items_for_moment(an.meta, m)
    for ins in an.insights(analysis["t"]):
        items += items_for_insight(an.meta, ins)
    _register(match_id, items)
    t = analysis["t"]
    return sorted((i for i in _items[match_id].values() if i["t"] <= t), key=lambda i: (-i["t"], -i["priority"]))


def proposals_for_moment(match_id: str, moment: dict) -> list[dict]:
    return _register(match_id, items_for_moment(store.get(match_id)["meta"], moment))


def proposals_for_insight(match_id: str, insight: dict) -> list[dict]:
    return _register(match_id, items_for_insight(store.get(match_id)["meta"], insight))


def add_item(match_id: str, new: dict) -> dict:
    """A graphic the producer adds by hand (e.g. from the half-time pack): same cue contract, editorial rules, approval
    flow and audit trail as agent proposals. Idempotent on `key`, so a double click does not queue it twice."""
    from ..analytics.engine import minute_of
    an = store.analyzer(match_id)
    item_id = f"si-pr-{new['key']}" if new.get("key") else f"si-pr-{uuid4().hex[:10]}"
    bucket = _items.setdefault(match_id, {})
    if item_id in bucket:
        return bucket[item_id]
    t = an.end_t if new.get("t") is None else max(0.0, min(float(new["t"]), an.end_t))
    item = {"id": item_id, "match_id": match_id, "moment_id": None, "t": t, "minute": minute_of(t, an.meta), "created_at": _now(),
            "status": "proposed", "kind": new["kind"], "priority": new["priority"], "duration_s": new["duration_s"],
            "title": new["title"], "body": new["body"], "source": "producer",
            "data": {**new.get("data", {}), "template": new.get("template") or new["kind"]}}
    attach_cue(match_id, item)
    bucket[item_id] = item
    audit(match_id, item_id, "proposed", "producer", item["title"])
    return item


def act(match_id: str, item_id: str, action: str, title: str | None = None, body: str | None = None) -> dict:
    item = _items.get(match_id, {}).get(item_id)
    if not item:
        raise KeyError(item_id)
    if action == "approve":
        item["status"] = "approved"
    elif action == "reject":
        item["status"] = "rejected"
    elif action == "edit":
        item["title"] = title or item["title"]
        item["body"] = body or item["body"]
        attach_cue(match_id, item)
    elif action == "on_air":
        if not item.get("editorial", {"passed": True})["passed"]:
            raise ValueError("Editorial rules block this item from going on air")
        item["status"] = "on_air"
        for q in list(_overlay_subscribers.get(match_id, ())):
            q.put_nowait(("on_air", item))
    elif action == "kill":
        item["status"] = "killed"
        for q in list(_overlay_subscribers.get(match_id, ())):
            q.put_nowait(("kill", {"id": item_id}))
    else:
        raise ValueError(action)
    audit(match_id, item_id, action, "producer", item["title"])
    return item


def subscribe(match_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    _overlay_subscribers.setdefault(match_id, set()).add(q)
    return q


def unsubscribe(match_id: str, q: asyncio.Queue) -> None:
    _overlay_subscribers.get(match_id, set()).discard(q)
