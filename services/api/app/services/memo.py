"""A per-process memo for expensive, deterministic results (calibration reports, counterfactual runs, speech audio)."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Hashable


class Memo[V]:
    """Computes each key once and keeps the result. Keys come from small, bounded sets, so nothing is evicted."""

    def __init__(self) -> None:
        self._values: dict[Hashable, V] = {}

    async def get(self, key: Hashable, compute: Callable[[], Awaitable[V]]) -> V:
        if key not in self._values:
            self._values[key] = await compute()
        return self._values[key]

    def __contains__(self, key: Hashable) -> bool:
        return key in self._values

    def clear(self) -> None:
        self._values.clear()
