"""Fact sheets: the only material a narrator is allowed to use.

A fact sheet is a numbered list of facts (f1, f2, ...) with labels, values and the event ids behind them, built
from the analytics engine and the real results dataset. Generated text must cite facts as [f3]; the fact-checker
rejects any number or citation that is not in the sheet.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Fact:
    fact_id: str
    label: str
    value: str | int | float
    event_ids: list[str] = field(default_factory=list)
    real: bool = False          # True when the fact comes from the real results dataset

    def to_citation(self) -> dict:
        d = {"fact_id": self.fact_id, "label": self.label, "value": self.value}
        if self.event_ids:
            d["event_ids"] = self.event_ids[:12]
        if self.real:
            d["real"] = True
        return d


@dataclass
class FactSheet:
    facts: list[Fact] = field(default_factory=list)
    context: list[str] = field(default_factory=list)   # non-numeric framing (teams, competition, persona notes)
    names: set[str] = field(default_factory=set)        # player and team names allowed in text

    def add(self, label: str, value, event_ids: list[str] | None = None, real: bool = False) -> str:
        fid = f"f{len(self.facts) + 1}"
        self.facts.append(Fact(fid, label, value, list(event_ids or []), real))
        return fid

    def by_id(self) -> dict[str, Fact]:
        return {f.fact_id: f for f in self.facts}

    def render(self) -> str:
        lines = [f"[{f.fact_id}] {f.label}: {f.value}{' (real result)' if f.real else ''}" for f in self.facts]
        return "\n".join(self.context + ["", "FACTS:"] + lines)


def _clock(m: dict) -> str:
    return f"{m['minute']}+{m['added_minute']}'" if m.get("added_minute") else f"{m['minute']}'"


def _pct(v: float) -> str:
    return f"{round(v * 100)}%"


def base_sheet(meta: dict, analysis: dict) -> FactSheet:
    fs = FactSheet()
    home, away = meta["home"], meta["away"]
    real = (meta.get("source") or {}).get("kind") == "real_result"
    fs.names |= {home["name"], away["name"]}
    for side in ("home", "away"):
        for p in meta[side]["players"]:
            fs.names.add(p["name"])
            fs.names.add(p["name"].split(" ")[-1])
    fs.context.append(f"MATCH: {home['name']} v {away['name']}, {meta['competition']}, {meta['kickoff']}, {meta['venue']}.")
    if real:
        fs.context.append("This is a REAL match: the result, scorers and goal minutes are real. The ball-by-ball events "
                          "(chances, passes, shapes) are a synthetic reconstruction. Never present synthetic detail as historical fact.")
    else:
        fs.context.append("This is a WHAT-IF match between real national teams. It never happened; everything is synthetic.")
    fs.context.append("MODEL: team strength and pre-match odds use Elo ratings computed from every men's international "
                      "result since 1872 (49,945 results, CC0 dataset).")
    sc = analysis["score"]
    fs.add("Score", f"{home['name']} {sc['home']}-{sc['away']} {away['name']}", real=real and analysis["t"] >= 0)
    fs.add("Match minute", analysis["minute"])
    sh, sa = analysis["stats"]["home"], analysis["stats"]["away"]
    fs.add(f"xG {home['name']}", sh["xg"])
    fs.add(f"xG {away['name']}", sa["xg"])
    fs.add(f"Shots {home['name']} (on target)", f"{sh['shots']} ({sh['shots_on_target']})")
    fs.add(f"Shots {away['name']} (on target)", f"{sa['shots']} ({sa['shots_on_target']})")
    fs.add(f"Possession {home['name']}", _pct(sh["possession"]))
    fs.add(f"Possession {away['name']}", _pct(sa["possession"]))
    fs.add(f"PPDA {home['name']} (lower = more intense pressing)", sh["ppda"])
    fs.add(f"PPDA {away['name']} (lower = more intense pressing)", sa["ppda"])
    fs.add(f"Field tilt {home['name']} (share of final-third passes)", _pct(sh["field_tilt"]))
    if analysis.get("win_prob"):
        wp = analysis["win_prob"][-1]
        fs.add(f"Win probability now ({home['name']}/draw/{away['name']})", f"{_pct(wp['home'])}/{_pct(wp['draw'])}/{_pct(wp['away'])}")
        wp0 = analysis["win_prob"][0]
        fs.add(f"Pre-match win probability ({home['name']}/draw/{away['name']})", f"{_pct(wp0['home'])}/{_pct(wp0['draw'])}/{_pct(wp0['away'])}")
    if meta.get("elo"):
        fs.add(f"Pre-match Elo {home['name']} v {away['name']}", f"{meta['elo']['home']} v {meta['elo']['away']}", real=True)
    h2h = meta.get("h2h") or {}
    if h2h.get("played"):
        fs.add(f"Head-to-head before this match ({home['name']} wins/draws/{away['name']} wins)",
               f"{h2h['home_wins']}/{h2h['draws']}/{h2h['away_wins']} in {h2h['played']} meetings", real=True)
    add_rhythm(fs, analysis)
    return fs


def _ordinal(n: int) -> str:
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def add_rhythm(fs: FactSheet, analysis: dict) -> None:
    """Game rhythm (MODEL): tempo and possession length per 15-minute window, so a line can say when the game sped up."""
    windows = analysis.get("rhythm") or []
    if len(windows) < 2:
        return
    fs.add("Game rhythm: passes a minute by 15-minute window", ", ".join(f"{w['from']}-{w['to']}' {w['passes_per_min']}" for w in windows))
    fs.add("Game rhythm: passes per possession by 15-minute window", ", ".join(f"{w['from']}-{w['to']}' {w['passes_per_possession']}" for w in windows))


def add_goal_milestones(fs: FactSheet, meta: dict, minute: int | None = None) -> None:
    """REAL career context for the real goals (all, or the one at `minute`): which competitive international goal it was.
    The CC0 goalscorers cover World Cups, qualifiers and continental cups, not friendlies, so the count is of competitive
    goals and is labelled so. A first goal, and every tenth, is flagged as a milestone."""
    real = (meta.get("source") or {}).get("real")
    if not real:
        return
    from ..forge.reference import reference
    ref, date = reference(), str(meta["kickoff"])[:10]
    for g in real["goals"]:
        if g["own_goal"] or (minute is not None and g["minute"] != minute):
            continue
        try:
            n = ref.career_goal_number(g["scorer"], ref.name_of(g["team_id"]), date, g["minute"])
        except KeyError:
            continue
        if not n:
            continue
        fs.add(f"{g['scorer']}'s competitive international goals (World Cups, qualifiers, continental cups; friendlies not "
               "counted), including this one", n, real=True)
        if n == 1 or n % 10 == 0:
            fs.add("Milestone", f"{g['scorer']}'s {_ordinal(n)} competitive international goal" + (" (his first)" if n == 1 else ""),
                   real=True)


def add_moment(fs: FactSheet, m: dict, prefix: str = "") -> None:
    fs.add(f"{prefix}{m['title']}", m["summary"], m["event_ids"])
    for e in m["evidence"]:
        if e["label"] == "Minute":
            continue
        fs.add(f"{prefix}{m['title']}: {e['label']}", e["value"], e.get("event_ids"))
        if e["label"] == "xG of the chance" and isinstance(e["value"], (int, float)):
            fs.add(f"{prefix}{m['title']}: chances like this are scored about N times in 10", round(e["value"] * 10))
    for f in m["explanation"]["factors"][:3]:
        fs.add(f"{prefix}{m['title']}: {f['name']}", f["detail"])


def moment_sheet(meta: dict, analysis: dict, moment: dict) -> FactSheet:
    fs = base_sheet(meta, analysis)
    fs.context.append(f"FOCUS MOMENT ({_clock(moment)}): {moment['title']}. {moment['explanation']['why_it_matters']}")
    add_moment(fs, moment)
    if moment["type"] == "goal":
        add_goal_milestones(fs, meta, moment["minute"])
    return fs


def full_sheet(meta: dict, analysis: dict, max_moments: int = 10) -> FactSheet:
    fs = base_sheet(meta, analysis)
    real = meta.get("source", {}).get("real")
    if real:
        for g in real["goals"]:
            tag = " (pen)" if g["penalty"] else " (own goal)" if g["own_goal"] else ""
            assist = f", assist {g['assist']}" if g.get("assist") else ""
            fs.add("Real goal", f"{g['scorer']}{tag} {g['minute']}'{assist}", real=True)
        add_goal_milestones(fs, meta)
    goals = [m for m in analysis["moments"] if m["type"] in ("goal", "turning_point")]
    others = sorted((m for m in analysis["moments"] if m not in goals), key=lambda m: -m["importance"])
    top = goals + others[:max(0, max_moments - len(goals))]
    for m in sorted(top, key=lambda m: m["t"]):
        add_moment(fs, m)
    for side in ("home", "away"):
        tac = analysis["tactics"][side]
        fs.add(f"{meta[side]['name']} detected shape", tac["formation"]["detected"])
        for s in tac["shifts"]:
            fs.add(f"{meta[side]['name']} shape change {s['minute']}'", f"{s['from']} to {s['to']}")
    for p in analysis["top_players"][:4]:
        fs.add(f"Player rating {p['name']}", p["rating"])
        if p["xt"] > 0.2:
            fs.add(f"Threat added by {p['name']} (xT)", p["xt"])
    return fs
