"""Video reader: the reasoning model (gpt-5.5) looks at frames sampled from any football clip and reports what it sees.

The browser samples about one frame a second and sends them in batches; the model answers in JSON for the batch, and the
web app adds the batches up into possession, passes, shots and a timeline. Unlike the calibrated detector on Regista's
own feed, nothing here is measured or checked against an event record: every number is the model's reading of the
pictures, and the page labels it so. `clean` keeps the model to the frames it was given and the vocabulary below.
"""

from __future__ import annotations

import json

from ..config import settings
from .clients import chat

EVENT_TYPES = ("pass", "shot", "goal", "save", "tackle", "foul", "corner", "free_kick", "throw_in", "goal_kick",
               "offside", "card", "substitution", "replay", "celebration")
ZONES = ("defensive_third", "middle_third", "attacking_third")

SYSTEM = (
    "You are a football match analyst reading frames sampled from a video clip, about one per second. Each image is "
    "preceded by its time in seconds. Report only what is visible; never guess. Call the two teams \"a\" and \"b\" and "
    "keep the labels you are given for them. Answer with JSON only:\n"
    '{"teams": {"a": {"kit": str, "name": str|null}, "b": {"kit": str, "name": str|null}},\n'
    ' "frames": [{"t": number, "view": "live"|"replay"|"close_up"|"graphic"|"crowd"|"other", "possession": "a"|"b"|null,\n'
    '             "zone": "defensive_third"|"middle_third"|"attacking_third"|null, "scoreboard": str|null}],\n'
    ' "events": [{"t": number, "type": one of ' + json.dumps(EVENT_TYPES) + ', "team": "a"|"b"|null, '
    '"description": str}],\n'
    ' "summary": str}\n'
    "Rules: one frames entry per image, with its time. kit is the shirt colour as seen (e.g. \"white shirts\"). name "
    "is the team only if a scoreboard, caption or badge shows it. possession is the team with the ball, or null when "
    "you can't tell. zone is where the ball is, from the possessing team's point of view. scoreboard is the on-screen "
    "score and clock text exactly as shown, or null. An event happens between or at the given frames: give the time "
    "of the frame that shows it best. Only report a pass when you see the ball move between team-mates across "
    "consecutive frames, a shot when the ball goes towards goal, a goal when the ball is in the net or a score changes. "
    "Treat replays as replays (view \"replay\"), never as new events. description is at most 12 words. summary is "
    "one plain sentence about what happened in these frames. No em dashes."
)


def _team(v) -> str | None:
    return v if v in ("a", "b") else None


def _text(v, limit: int) -> str | None:
    if not isinstance(v, (str, int, float)) or isinstance(v, bool):
        return None
    return str(v).strip()[:limit] or None


def clean(raw: dict, times: list[float], teams: dict | None = None) -> dict:
    """The model's answer kept to the frames it was sent: known event types and zones only, times snapped to a sent
    frame, and team labels from earlier batches kept so "a" stays the same team for the whole clip."""
    if not times:
        return {"teams": teams or {}, "frames": [], "events": [], "summary": ""}
    lo, hi = min(times), max(times)

    def snap(t) -> float | None:
        try:
            t = float(t)
        except (TypeError, ValueError):
            return None
        if t < lo - 1.5 or t > hi + 1.5:
            return None
        return min(times, key=lambda x: abs(x - t))

    got = raw.get("teams") if isinstance(raw.get("teams"), dict) else {}
    out_teams = {}
    for side in ("a", "b"):
        prior = (teams or {}).get(side) or {}
        seen = got.get(side) if isinstance(got.get(side), dict) else {}
        out_teams[side] = {"kit": prior.get("kit") or _text(seen.get("kit"), 40) or ("team A" if side == "a" else "team B"),
                           "name": prior.get("name") or _text(seen.get("name"), 40)}

    frames, done = [], set()
    for f in raw.get("frames") or []:
        if not isinstance(f, dict):
            continue
        t = snap(f.get("t"))
        if t is None or t in done:
            continue
        done.add(t)
        view = f.get("view") if f.get("view") in ("live", "replay", "close_up", "graphic", "crowd", "other") else "other"
        frames.append({"t": t, "view": view, "possession": _team(f.get("possession")) if view == "live" else None,
                       "zone": f.get("zone") if f.get("zone") in ZONES else None,
                       "scoreboard": _text(f.get("scoreboard"), 40)})
    frames.sort(key=lambda f: f["t"])

    events = []
    for e in raw.get("events") or []:
        if not isinstance(e, dict) or e.get("type") not in EVENT_TYPES:
            continue
        t = snap(e.get("t"))
        if t is None:
            continue
        events.append({"t": t, "type": e["type"], "team": _team(e.get("team")),
                       "description": _text(e.get("description"), 120) or e["type"].replace("_", " ")})
    events.sort(key=lambda e: e["t"])
    return {"teams": out_teams, "frames": frames, "events": events, "summary": _text(raw.get("summary"), 300) or ""}


async def read_frames(frames: list[dict], teams: dict | None = None) -> dict:
    """One batch of frames ({t, image as a data URL}) read by the reasoning deployment."""
    content: list[dict] = []
    if teams:
        content.append({"type": "text", "text": "Team labels so far (keep them): " + json.dumps(teams)})
    for f in frames:
        content.append({"type": "text", "text": f"t = {f['t']:.1f} s"})
        content.append({"type": "image_url", "image_url": {"url": f["image"], "detail": "low"}})
    resp = await chat([{"role": "system", "content": SYSTEM}, {"role": "user", "content": content}],
                      deployment=settings.reasoning_deployment, json_mode=True, max_tokens=4000)
    text = resp.choices[0].message.content or "{}"
    try:
        raw = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        raw = json.loads(text[start:end + 1]) if start >= 0 else {}
    out = clean(raw if isinstance(raw, dict) else {}, [f["t"] for f in frames], teams)
    out["model"] = settings.reasoning_deployment
    return out
