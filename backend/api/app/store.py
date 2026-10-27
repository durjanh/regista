"""In-process match repository: featured real-result rebuilds, generated what-if matches and their analyses."""

from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path

from .analytics import xt
from .analytics.engine import MatchAnalyzer
from .forge import physical
from .forge.matches import build_real_match, build_what_if
from .forge.reference import FEATURED, REPO_ROOT, reference

log = logging.getLogger("regista.store")

DATA_DIR = Path(os.environ.get("REGISTA_DATA_DIR") or REPO_ROOT / "data" / "matches")
XT_PATH = REPO_ROOT / "data" / "reference" / "xt_grid.json"


class MatchStore:
    def __init__(self, data_dir: Path = DATA_DIR):
        self.dir = data_dir
        self.dir.mkdir(parents=True, exist_ok=True)
        self.docs: dict[str, dict] = {}
        self.analyzers: dict[str, MatchAnalyzer] = {}
        self.order: list[str] = []
        self.lock = threading.Lock()
        self.scout_lock = threading.Lock()
        self.corpus: list[dict] = []
        self.xt_grid: list[list[float]] = []

    # ------------------------------------------------------------------ loading

    def load(self) -> None:
        ref = reference()
        for d, h, a in FEATURED:
            mid_guess = f"{d}-{_slug(h)}-{_slug(a)}"
            path = self.dir / f"{mid_guess}.json"
            if path.exists():
                doc = json.loads(path.read_text())
            else:
                log.info("Building real-result rebuild %s", mid_guess)
                doc = build_real_match(d, h, a, ref=ref)
                path.write_text(json.dumps(doc, separators=(",", ":")))
            self._register(doc, featured=True)
        for path in sorted(self.dir.glob("whatif-*.json")):
            self._register(json.loads(path.read_text()), featured=False)
        grid = xt.load(XT_PATH)
        if grid is None:
            sample = list(self.docs.values())
            sample += [build_what_if(h, a, seed=500 + i, max_tries=1, ref=ref)
                       for i, (h, a) in enumerate(_pairs(ref, 24))]
            grid = xt.fit_xt(sample)
            xt.save(grid, XT_PATH)
        self.xt_grid = grid
        for doc in self.docs.values():
            xt.annotate(doc["events"], grid)

    def _register(self, doc: dict, featured: bool) -> None:
        mid = doc["meta"]["match_id"]
        doc["meta"]["featured"] = featured
        physical.attach(doc)   # distance-milestone tags, also on cached and restored matches
        with self.lock:
            self.docs[mid] = doc
            self.analyzers.pop(mid, None)
            if mid not in self.order:
                self.order.append(mid)
        if self.xt_grid:
            xt.annotate(doc["events"], self.xt_grid)

    def add_rebuilt(self, doc: dict, keep: int = 30) -> None:
        """A real result a viewer asked to replay. The newest `keep` stay; older ones are dropped (they rebuild on demand)."""
        doc["meta"]["rebuilt"] = True
        self._register(doc, featured=False)
        with self.lock:
            rebuilt = [m for m in self.order if self.docs[m]["meta"].get("rebuilt")]
            for old in rebuilt[:-keep] if len(rebuilt) > keep else []:
                self.order.remove(old)
                self.docs.pop(old, None)
                self.analyzers.pop(old, None)

    def add_generated(self, doc: dict, persist: bool = True) -> None:
        self._register(doc, featured=False)
        if persist:
            (self.dir / f"{doc['meta']['match_id']}.json").write_text(json.dumps(doc, separators=(",", ":")))

    # ------------------------------------------------------------------ access

    def get(self, match_id: str) -> dict:
        if match_id not in self.docs:
            raise KeyError(match_id)
        return self.docs[match_id]

    def analyzer(self, match_id: str) -> MatchAnalyzer:
        with self.lock:
            if match_id not in self.analyzers:
                self.analyzers[match_id] = MatchAnalyzer(self.get(match_id))
            return self.analyzers[match_id]

    # ------------------------------------------------------------------ scouting corpus

    def build_corpus(self, per_team: int | None = None, others_per_team: int | None = None) -> list[dict]:
        """Simulated matches (not listed in /api/matches) so scouting has enough minutes, shots and penalties per
        player to rediscover tendencies: `per_team` for each featured team, and `others_per_team` for every other
        team in the Elo top 32, so a top side never goes unscouted just because no featured fixture includes it."""
        if self.corpus:
            return self.corpus
        per_team = per_team if per_team is not None else int(os.environ.get("REGISTA_CORPUS_PER_TEAM", "6"))
        others_per_team = (others_per_team if others_per_team is not None
                           else int(os.environ.get("REGISTA_CORPUS_OTHERS_PER_TEAM", "4")))
        ref = reference()
        featured_teams = sorted({_slug(t) for _, h, a in FEATURED for t in (h, a)})
        top = [t["team_id"] for t in ref.ranking(limit=24)]
        docs = []

        def simulate(home: str, away: str, seed: int, neutral: bool) -> None:
            doc = build_what_if(home, away, seed=seed, max_tries=1, neutral=neutral, ref=ref)
            if self.xt_grid:
                xt.annotate(doc["events"], self.xt_grid)
            docs.append(doc)

        for i, tid in enumerate(featured_teams):
            opponents = [t for t in featured_teams + top if t != tid]
            for k in range(per_team):
                opp = opponents[(i * 3 + k * 5) % len(opponents)]
                home, away = (tid, opp) if k % 2 == 0 else (opp, tid)
                simulate(home, away, 7000 + i * 100 + k, neutral=(k % 3 == 0))
        # The rest of the top 32, against the featured teams (their own seed range, so the games above don't change).
        others = [t["team_id"] for t in ref.ranking(limit=32) if t["team_id"] not in featured_teams]
        for j, tid in enumerate(others):
            for k in range(others_per_team):
                opp = featured_teams[(j * 3 + k * 5) % len(featured_teams)]
                home, away = (tid, opp) if k % 2 == 0 else (opp, tid)
                simulate(home, away, 9000 + j * 100 + k, neutral=(k % 3 == 0))
        self.corpus = docs
        return docs

    def ensure_scouting(self):
        from .analytics.scouting import scouting
        if scouting.ready:
            return scouting
        with self.scout_lock:
            if not scouting.ready:
                corpus = self.build_corpus()
                scouting.build(list(self.docs.values()) + corpus)
        return scouting

    def scouting_if_ready(self):
        """The scouting index if it is built, else None after starting the build in the background. For views that use
        scouting only as extra context (the dugout's form baselines), so a cold start never makes them wait ~15 s."""
        from .analytics.scouting import scouting
        if scouting.ready:
            return scouting
        if not self.scout_lock.locked():
            threading.Thread(target=self.ensure_scouting, name="scouting-build", daemon=True).start()
        return None

    def summaries(self) -> list[dict]:
        out = []
        for mid in self.order:
            m = self.docs[mid]["meta"]
            s = {k: v for k, v in m.items() if k not in ("home", "away", "truth", "h2h")}
            s["planted_changes"] = len((m.get("truth") or {}).get("plants", []))
            s["home"] = {k: m["home"][k] for k in ("team_id", "name", "short", "colors")}
            s["away"] = {k: m["away"][k] for k in ("team_id", "name", "short", "colors")}
            if "source" in s:
                src = dict(s["source"])
                src.pop("disclosure", None)
                s["source"] = src
            out.append(s)
        out.sort(key=lambda s: (not s.get("featured"), s.get("kickoff", "")), reverse=False)
        featured = sorted([s for s in out if s.get("featured")], key=lambda s: s["kickoff"], reverse=True)
        others = [s for s in out if not s.get("featured")]
        return featured + others


def _slug(name: str) -> str:
    from .forge.reference import slug
    return slug(name)


def _pairs(ref, n: int) -> list[tuple[str, str]]:
    teams = [t["team_id"] for t in ref.ranking(limit=32)]
    return [(teams[i % len(teams)], teams[(i * 7 + 3) % len(teams)]) for i in range(n) if teams[i % len(teams)] != teams[(i * 7 + 3) % len(teams)]]


store = MatchStore()
