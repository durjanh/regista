#!/usr/bin/env python3
"""Load test for the Web PubSub broadcast: N concurrent viewers on one match, measuring delivery latency.

    python scripts/loadtest-realtime.py --api https://<api> --match-id 2026-07-15-england-argentina \\
        --clients 500 --seconds 60 [--start --speed 30] [--ramp 50]

Each viewer negotiates a client URL (one token is shared by a batch of viewers: the roles are identical), opens a
WebSocket with the json.webpubsub.azure.v1 subprotocol, joins match.{id} and records, for every tick, now - sent_at
(the API stamps sent_at when it publishes). Clock skew between this machine and the API adds directly to the numbers,
so run it from a machine with NTP-synced time. Report: connections established/failed, ticks received per viewer,
missed ticks (gaps in seq) and p50/p95/p99 delivery latency.

Size it to the Web PubSub capacity you deployed (1 unit = 1,000 concurrent connections) and to your machine's file
descriptor limit (`ulimit -n`). Needs: pip install websockets httpx
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time

import httpx
import websockets

SUBPROTOCOL = "json.webpubsub.azure.v1"


class Viewer:
    def __init__(self, n: int):
        self.n = n
        self.connected = False
        self.error: str | None = None
        self.latencies: list[float] = []
        self.seqs: list[int] = []

    async def run(self, url: str, group: str, until: float) -> None:
        try:
            async with websockets.connect(url, subprotocols=[SUBPROTOCOL], open_timeout=30, max_size=2**22) as ws:
                await ws.send(json.dumps({"type": "joinGroup", "group": group, "ackId": self.n + 1}))
                while time.time() < until:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, until - time.time()))
                    except TimeoutError:
                        break
                    msg = json.loads(raw)
                    if msg.get("type") == "ack":
                        if not msg.get("success", True):
                            self.error = f"joinGroup refused: {msg.get('error')}"
                            return
                        self.connected = True
                    elif msg.get("type") == "message" and isinstance(msg.get("data"), dict) and msg["data"].get("type") == "tick":
                        data = msg["data"]
                        self.latencies.append(time.time() * 1000 - data["sent_at"])
                        self.seqs.append(data["seq"])
        except Exception as exc:
            self.error = f"{type(exc).__name__}: {exc}"


def missed(seqs: list[int]) -> int:
    return sum(b - a - 1 for a, b in zip(seqs, seqs[1:], strict=False) if b > a + 1)


def pct(values: list[float], q: float) -> float:
    s = sorted(values)
    return s[min(len(s) - 1, int(len(s) * q))] if s else float("nan")


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", required=True, help="API base URL, e.g. https://regista-api.<env>.azurecontainerapps.io")
    ap.add_argument("--match-id", required=True)
    ap.add_argument("--clients", type=int, default=100)
    ap.add_argument("--seconds", type=int, default=60, help="How long every viewer stays connected after ramp-up")
    ap.add_argument("--ramp", type=float, default=50, help="New connections per second (be gentle)")
    ap.add_argument("--batch", type=int, default=100, help="Viewers sharing one negotiated token")
    ap.add_argument("--start", action="store_true", help="Start the broadcast first (POST /api/broadcast/{id}/start)")
    ap.add_argument("--speed", type=float, default=30)
    args = ap.parse_args()

    api = args.api.rstrip("/")
    async with httpx.AsyncClient(timeout=30) as http:
        if args.start:
            r = await http.post(f"{api}/api/broadcast/{args.match_id}/start", json={"speed": args.speed})
            r.raise_for_status()
            print("broadcast:", r.json())
        tokens = []
        for _ in range((args.clients + args.batch - 1) // args.batch):
            neg = (await http.get(f"{api}/api/realtime/negotiate", params={"match_id": args.match_id})).json()
            if not neg.get("enabled"):
                raise SystemExit("Web PubSub is not enabled on this API (negotiate returned enabled=false).")
            tokens.append(neg["url"])
            group = neg["groups"][0]

    viewers = [Viewer(i) for i in range(args.clients)]
    ramp_s = args.clients / args.ramp
    until = time.time() + ramp_s + args.seconds
    tasks = []
    t0 = time.time()
    for i, v in enumerate(viewers):
        tasks.append(asyncio.create_task(v.run(tokens[i // args.batch], group, until)))
        await asyncio.sleep(1 / args.ramp)
    print(f"ramped {args.clients} viewers in {time.time() - t0:.1f} s; holding {args.seconds} s…")
    await asyncio.gather(*tasks)

    ok = [v for v in viewers if v.connected]
    lat = [x for v in ok for x in v.latencies]
    received = [len(v.seqs) for v in ok]
    print(json.dumps({
        "viewers": args.clients, "connected": len(ok), "failed": args.clients - len(ok),
        "errors": sorted({v.error for v in viewers if v.error})[:5],
        "ticks_per_viewer": {"min": min(received, default=0), "median": statistics.median(received) if received else 0, "max": max(received, default=0)},
        "missed_ticks": sum(missed(v.seqs) for v in ok),
        "delivery_ms": {"p50": round(pct(lat, 0.50), 1), "p95": round(pct(lat, 0.95), 1), "p99": round(pct(lat, 0.99), 1), "samples": len(lat)},
    }, indent=2))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
