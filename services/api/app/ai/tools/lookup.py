"""Lookups the tools share: a match minute as replay seconds, a player by name, surname or id."""

from __future__ import annotations

from ...store import store


def minute_to_t(match_id: str, minute: int | None) -> float | None:
    if minute is None:
        return None
    meta = store.get(match_id)["meta"]
    p2 = meta.get("period_starts", [0, 2700])[1]
    return minute * 60.0 if minute <= 45 else p2 + (minute - 45) * 60.0


def find_player(match_id: str, name_or_id: str) -> dict | None:
    meta = store.get(match_id)["meta"]
    q = name_or_id.lower().strip()
    for side in ("home", "away"):
        for p in meta[side]["players"]:
            if p["player_id"].lower() == q or p["name"].lower() == q or p["name"].lower().split(" ")[-1] == q or q in p["name"].lower():
                return p
    return None
