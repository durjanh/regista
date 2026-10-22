"""Synthetic season generator: a full double round-robin between real national teams, at event level, with hidden
planted changes and a realism report. Output lands on disk (JSON Lines) and, when configured, in the Microsoft
Fabric Lakehouse (OneLake Files/regista/season/...) for Spark, SQL and the Fabric data agent.

    python -m app.forge.season --teams 20 --out ../../data/season            # 380 matches
    python -m app.forge.season --teams 8 --plants 0.5 --upload               # 56 matches, plants in half, upload to OneLake
"""

from __future__ import annotations

import argparse
import json
import random
import statistics
import time
from collections import Counter
from pathlib import Path

from .calibration import EVENT_BENCHMARKS
from .matches import build_what_if
from .reference import reference

MECHANISMS = ["press_switch", "tiring_fullback", "chaos_spell", "hot_streak", "set_piece_routine", "shape_change"]


def random_plants(rng: random.Random) -> list[dict]:
    out = []
    for j, mech in enumerate(rng.sample(MECHANISMS, rng.choice([1, 2]))):
        p = {"id": f"s{j}", "mechanism": mech, "side": rng.choice(["home", "away"]), "minute": rng.randint(25, 70),
             "difficulty": rng.choice(["obvious", "moderate", "subtle"]), "description": mech.replace("_", " ")}
        if mech == "press_switch":
            p["direction"] = "higher"
        elif mech == "shape_change":
            p["direction"] = "back_five"
        elif mech == "chaos_spell":
            p.update(side="both", duration=9)
        elif mech == "hot_streak":
            p.update(position="ST", duration=15)
        elif mech == "tiring_fullback":
            p["position"] = rng.choice(["RB", "LB"])
        out.append(p)
    return out


def realism_report(docs: list[dict]) -> list[dict]:
    def per_match(pred) -> float:
        return statistics.mean(sum(1 for e in d["events"] if pred(e)) for d in docs)
    shots = [e for d in docs for e in d["events"] if e["type"] == "shot"]
    passes = [e for d in docs for e in d["events"] if e["type"] == "pass"]
    values = {
        "Shots per match": per_match(lambda e: e["type"] == "shot"),
        "Shots on target per match": per_match(lambda e: e.get("shot_outcome") in ("goal", "saved")),
        "Passes per match": len(passes) / len(docs),
        "Pass completion": sum(1 for e in passes if e["outcome"] == "success") / max(1, len(passes)),
        "Corners per match": per_match(lambda e: e["type"] == "corner"),
        "Fouls per match": per_match(lambda e: e["type"] == "foul"),
        "Yellow cards per match": per_match(lambda e: e.get("card") == "yellow"),
        "Offsides per match": per_match(lambda e: e["type"] == "offside"),
        "xG per shot": sum(e.get("xg", 0) for e in shots) / max(1, len(shots)),
        "xG per match": sum(e.get("xg", 0) for e in shots) / len(docs),
    }
    return [{"metric": name, "value": round(values[name], 3), "low": low, "high": high, "status": "pass" if low <= values[name] <= high else "warn",
             "source": "Typical top-flight club football range (benchmark)"} for name, low, high, _ in EVENT_BENCHMARKS]


def generate(n_teams: int = 20, plant_share: float = 0.6, seed: int = 2026) -> tuple[list[dict], dict]:
    ref = reference()
    teams = [t["team_id"] for t in ref.ranking(limit=n_teams)]
    rng = random.Random(seed)
    docs = []
    k = 0
    for h in teams:
        for a in teams:
            if h == a:
                continue
            plants = random_plants(rng) if rng.random() < plant_share else []
            docs.append(build_what_if(h, a, seed=seed + k, max_tries=1, neutral=False, plants=plants, ref=ref))
            k += 1
    table: dict[str, Counter] = {t: Counter() for t in teams}
    for d in docs:
        hs, as_ = d["meta"]["final_score"]["home"], d["meta"]["final_score"]["away"]
        h, a = d["meta"]["home"]["team_id"], d["meta"]["away"]["team_id"]
        for tid, gf, ga in ((h, hs, as_), (a, as_, hs)):
            t = table[tid]
            t["P"] += 1
            t["GF"] += gf
            t["GA"] += ga
            t["W" if gf > ga else "D" if gf == ga else "L"] += 1
            t["Pts"] += 3 if gf > ga else 1 if gf == ga else 0
    standings = sorted(({"team_id": t, **c} for t, c in table.items()), key=lambda r: (-r["Pts"], -(r["GF"] - r["GA"]), -r["GF"]))
    goals = [sum(d["meta"]["final_score"].values()) for d in docs]
    summary = {"matches": len(docs), "teams": n_teams, "seed": seed, "goals_per_match": round(statistics.mean(goals), 3),
               "home_win_rate": round(sum(1 for d in docs if d["meta"]["final_score"]["home"] > d["meta"]["final_score"]["away"]) / len(docs), 3),
               "draw_rate": round(sum(1 for d in docs if d["meta"]["final_score"]["home"] == d["meta"]["final_score"]["away"]) / len(docs), 3),
               "planted_changes": sum(len(d["meta"]["truth"]["plants"]) for d in docs),
               "realism": realism_report(docs), "standings": standings}
    return docs, summary


def write(docs: list[dict], summary: dict, out: Path, upload: bool = False) -> None:
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "matches.jsonl", "w") as fm, open(out / "events.jsonl", "w") as fe, open(out / "plants.jsonl", "w") as fp:
        for d in docs:
            m = {k: v for k, v in d["meta"].items() if k not in ("home", "away", "truth")}
            m.update(home_team_id=d["meta"]["home"]["team_id"], away_team_id=d["meta"]["away"]["team_id"])
            fm.write(json.dumps(m, default=str) + "\n")
            for e in d["events"]:
                fe.write(json.dumps({k: v for k, v in e.items() if k != "freeze_frame"}, default=str) + "\n")
            for p in d["meta"]["truth"]["plants"]:
                fp.write(json.dumps({"match_id": d["meta"]["match_id"], **p}, default=str) + "\n")
    (out / "season_summary.json").write_text(json.dumps(summary, indent=2, default=str))
    if upload:
        import asyncio

        from ..config import settings
        from ..integrations.persistence import _onelake
        if not (settings.onelake_workspace and settings.onelake_lakehouse):
            raise SystemExit("Set ONELAKE_WORKSPACE and ONELAKE_LAKEHOUSE to upload")

        async def push() -> None:
            for name in ("matches.jsonl", "events.jsonl", "plants.jsonl", "season_summary.json"):
                await _onelake(f"regista/season/{name}", (out / name).read_bytes())
        asyncio.run(push())


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a synthetic season with planted changes and a realism report")
    parser.add_argument("--teams", type=int, default=20)
    parser.add_argument("--plants", type=float, default=0.6, help="Share of matches with hidden planted changes")
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--out", default=str(Path(__file__).resolve().parents[4] / "data" / "season"))
    parser.add_argument("--upload", action="store_true", help="Also upload to the Fabric Lakehouse (OneLake)")
    args = parser.parse_args()
    t0 = time.time()
    docs, summary = generate(args.teams, args.plants, args.seed)
    write(docs, summary, Path(args.out), args.upload)
    passed = sum(1 for r in summary["realism"] if r["status"] == "pass")
    print(json.dumps({k: summary[k] for k in ("matches", "goals_per_match", "home_win_rate", "draw_rate", "planted_changes")}
                     | {"realism": f"{passed}/{len(summary['realism'])} in range", "seconds": round(time.time() - t0, 1),
                        "out": args.out}, indent=2))


if __name__ == "__main__":
    main()
