"""Operations: latency SLO and cost per match.

Every model call records its token usage against the match being processed (a context variable set by the
narrator, recap, ask and coach entry points). Prices are configuration, not facts baked into code: set
PRICE_INPUT_PER_1M / PRICE_OUTPUT_PER_1M (USD per million tokens) from your Azure agreement.
"""

from __future__ import annotations

import contextvars
import os
import time
from collections import defaultdict

current_match: contextvars.ContextVar[str] = contextvars.ContextVar("current_match", default="-")
STARTED = time.time()
SLO_TARGET_MS = int(os.environ.get("SLO_NARRATIVE_P95_MS", "3000"))
PRICE_IN = float(os.environ.get("PRICE_INPUT_PER_1M", "0.25"))
PRICE_OUT = float(os.environ.get("PRICE_OUTPUT_PER_1M", "2.0"))

_calls: dict[str, dict] = defaultdict(lambda: {"model_calls": 0, "input_tokens": 0, "output_tokens": 0})
_latencies: list[int] = []


def record_usage(input_tokens: int | None, output_tokens: int | None) -> None:
    c = _calls[current_match.get()]
    c["model_calls"] += 1
    c["input_tokens"] += int(input_tokens or 0)
    c["output_tokens"] += int(output_tokens or 0)


def record_latency(ms: int) -> None:
    _latencies.append(int(ms))
    del _latencies[:-500]


def _cost(c: dict) -> float:
    return round(c["input_tokens"] / 1e6 * PRICE_IN + c["output_tokens"] / 1e6 * PRICE_OUT, 4)


def report(mode: str) -> dict:
    lat = sorted(_latencies)
    p50 = lat[len(lat) // 2] if lat else None
    p95 = lat[min(len(lat) - 1, int(len(lat) * 0.95))] if lat else None
    total = {"model_calls": 0, "input_tokens": 0, "output_tokens": 0}
    for c in _calls.values():
        for k in total:
            total[k] += c[k]
    return {
        "mode": mode, "uptime_s": int(time.time() - STARTED),
        "slo": {"target_p95_ms": SLO_TARGET_MS, "p50_ms": p50, "p95_ms": p95, "samples": len(lat),
                "compliant": (p95 <= SLO_TARGET_MS) if p95 is not None else None},
        "cost": {**total, "est_cost_usd": _cost(total),
                 "per_match": sorted(({"match_id": m, "model_calls": c["model_calls"], "est_cost_usd": _cost(c)} for m, c in _calls.items() if m != "-"),
                                     key=lambda r: -r["est_cost_usd"]),
                 "price_note": (f"Estimated at ${PRICE_IN}/1M input and ${PRICE_OUT}/1M output tokens (illustrative). "
                                "Set PRICE_INPUT_PER_1M / PRICE_OUTPUT_PER_1M from your Azure pricing.")},
    }
