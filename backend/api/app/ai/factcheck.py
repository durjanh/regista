"""Deterministic fact-checker and fair-commentary guardrail.

1. Every number in generated text must appear in the fact sheet (with format variants: 0.34 ~ 34%, 1-0 ~ 1 and 0).
2. Every [fN] citation must exist in the fact sheet.
3. Fair commentary: research on football commentary (e.g. the 2020 RunRepeat/PFA study) found players described
   with innate-trait language ("natural pace and power") unevenly across groups. We flag innate-trait descriptors
   and ask for evidence-based description of what the player actually did.
"""

from __future__ import annotations

import random
import re

from .facts import FactSheet

NUM_RE = re.compile(r"(?<![\w.])(\d+(?:\.\d+)?)(%|')?")
CITE_RE = re.compile(r"\[(f\d+)\]")
SENT_RE = re.compile(r"(?<=[.!?])\s+")
FREE_NUMBERS = {str(i) for i in range(0, 4)} | {"10", "11", "45", "90", "100"}

BIAS_PHRASES = {
    "natural athlete": "describe what they did (distance covered, duels won) rather than innate traits",
    "natural ability": "credit the specific action, e.g. 'the first touch took two defenders out'",
    "naturally gifted": "describe the skill shown in this match",
    "raw pace": "say how the pace was used, e.g. 'ran in behind the high line'",
    "pace and power": "describe the action: 'carried the ball 30 metres past two challenges'",
    "physical specimen": "describe the duel or action instead",
    "powerhouse": "describe the action instead",
    "freak of nature": "describe the action instead",
    "beast": "describe the action instead",
    "brute strength": "describe the duel instead",
    "athleticism": "describe the specific action and its effect",
    "lazy": "use evidence, e.g. pressing actions or distance, not character judgements",
    "hot-headed": "describe the incident factually",
    "temperamental": "describe the incident factually",
    "instinctive finisher": "cite the finish: 'one-touch finish from 8 metres'",
}


def _variants(value) -> set[str]:
    out = set()
    text = str(value)
    for num, suffix in NUM_RE.findall(text):
        out.add(num.rstrip("0").rstrip(".") if "." in num else num)
        out.add(num)
        try:
            f = float(num)
        except ValueError:
            continue
        if suffix == "%":
            out.add(str(int(f)))
            out.add(f"{f / 100:.2f}")
        if "." in num and f <= 1:
            out.add(str(round(f * 100)))                 # 0.34 -> 34 (as a percentage)
            out.add(f"{f:.1f}")
            out.add(f"{f:.2f}")
            out.add(f"{f:.2f}".lstrip("0"))
        if "." in num:
            out.add(f"{f:.1f}")
            out.add(str(round(f)))
    return out


def allowed_numbers(fs: FactSheet) -> set[str]:
    allowed = set(FREE_NUMBERS)
    for f in fs.facts:
        allowed |= _variants(f.value)
        allowed |= _variants(f.label)
    for c in fs.context:
        allowed |= _variants(c)
    return allowed


def check(text: str, fs: FactSheet) -> dict:
    allowed = allowed_numbers(fs)
    ids = set(fs.by_id())
    issues, checked = [], 0
    for sentence in SENT_RE.split(text):
        clean = CITE_RE.sub("", sentence)
        for num, suffix in NUM_RE.findall(clean):
            checked += 1
            norm = num.rstrip("0").rstrip(".") if "." in num else num
            if num not in allowed and norm not in allowed:
                issues.append({"sentence": sentence.strip()[:240], "problem": f"Number {num}{suffix or ''} is not in the fact sheet"})
        for cid in CITE_RE.findall(sentence):
            checked += 1
            if cid not in ids:
                issues.append({"sentence": sentence.strip()[:240], "problem": f"Citation [{cid}] does not exist"})
    lower = text.lower()
    bias = [{"phrase": p, "suggestion": s} for p, s in BIAS_PHRASES.items() if re.search(rf"\b{re.escape(p)}\b", lower)]
    return {"passed": not issues and not bias, "checked_claims": checked, "issues": issues, "bias_flags": bias}


def plant_error(text: str, fs: FactSheet, rng: random.Random) -> dict | None:
    """Verifier drill: overstate the headline number in a draft, the claim-level twin of a planted tactical change.

    Returns the faulty draft and the exact problem the Verifier must raise, or None if the draft has no stat to inflate.
    Minutes and free numbers are left alone; the inflated value is guaranteed not to appear anywhere in the evidence.
    """
    allowed = allowed_numbers(fs)
    spots = [m for m in NUM_RE.finditer(text) if m.group(2) != "'" and m.group(1) not in FREE_NUMBERS and m.group(1) in allowed]
    if not spots:
        return None
    m = max(spots, key=lambda s: float(s.group(1)) / (100 if s.group(2) == "%" else 1))   # the headline stat
    num, suffix = m.group(1), m.group(2) or ""
    decimals = len(num.split(".")[1]) if "." in num else 0
    value = float(num) * rng.uniform(1.5, 2.2)
    if decimals:
        candidates = [f"{value + k * 10 ** -decimals:.{decimals}f}" for k in range(50)]
    else:
        base = int(num)
        hi = 99 if suffix == "%" else round(value) + 50
        lo = min(max(base + 1, round(value)), hi)
        candidates = [str(v) for v in [*range(lo, hi + 1), *range(base + 1, lo)]]
    new = next((c for c in candidates if c not in allowed and c.rstrip("0").rstrip(".") not in allowed), None)
    if new is None:
        return None
    return {"text": text[:m.start(1)] + new + text[m.end(1):], "original": num + suffix, "planted": new + suffix,
            "problem": f"Number {new}{suffix} is not in the fact sheet"}


def strip_unsupported(text: str, report: dict) -> str:
    """Remove sentences the checker rejected (used when a repair round still fails)."""
    bad = {i["sentence"] for i in report["issues"]}
    lines = []
    for line in text.split("\n"):
        kept = [s for s in SENT_RE.split(line) if s.strip()[:240] not in bad]
        lines.append(" ".join(kept).rstrip())
    return "\n".join(lines).strip()


def citations_used(text: str, fs: FactSheet) -> list[dict]:
    by_id = fs.by_id()
    seen, out = set(), []
    for cid in CITE_RE.findall(text):
        if cid in by_id and cid not in seen:
            seen.add(cid)
            out.append(by_id[cid].to_citation())
    return out
