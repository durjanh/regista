"""Request bodies, validated by FastAPI. Responses are the domain dictionaries (documented in docs/API_CONTRACT.md)."""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, Field


class BroadcastStart(BaseModel):
    speed: float = Field(1, ge=1, le=600)
    start_t: float = Field(0, ge=0)
    languages: list[str] = Field(default_factory=lambda: ["en"], max_length=6)


class NarrateRequest(BaseModel):
    match_id: str
    scope: str = Field("moment", pattern="^(moment|live_line|halftime|fulltime)$")
    moment_id: str | None = None
    persona: str = "casual"
    language: str = "en"
    upto_t: float | None = None


class RecapRequest(BaseModel):
    match_id: str
    persona: str = "broadcaster"
    language: str = "en"


class AskRequest(BaseModel):
    match_id: str
    question: str = Field(..., min_length=2, max_length=600)
    persona: str = "casual"
    language: str = "en"
    upto_t: float | None = None
    history: list[dict] | None = None


class SpeechRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    language: str = "en"
    persona: str | None = None


class TranslateRequest(BaseModel):
    # The web app translates a page in batches of up to 100 strings; Translator's own limit is 1,000 and 50,000 characters.
    texts: list[Annotated[str, Field(max_length=2000)]] = Field(..., max_length=100)
    to: str = Field(..., pattern=r"^[a-z]{2,3}(-[A-Za-z]{2,4})?$")


class StudioAction(BaseModel):
    action: str = Field(..., pattern="^(approve|reject|on_air|edit|kill)$")
    title: str | None = None
    body: str | None = None


class StudioNewItem(BaseModel):
    kind: str = Field(..., pattern="^(lower_third|stat_card|talking_point|replay_cue|score_bug_alert)$")
    title: str = Field(..., min_length=1, max_length=120)
    body: str = Field("", max_length=400)
    priority: int = Field(60, ge=0, le=100)
    duration_s: int = Field(10, ge=3, le=30)
    t: float | None = None
    template: str | None = Field(None, max_length=40)
    data: dict = Field(default_factory=dict)
    key: str | None = Field(None, pattern="^[a-z0-9-]{1,40}$")


class StudioSettings(BaseModel):
    profile_id: str | None = None
    auto_approve_threshold: float | None = None
    clear_threshold: bool = False


class InsightNarrateRequest(BaseModel):
    persona: str = "analyst"
    language: str = "en"
    drill: bool = False


class CounterfactualRequest(BaseModel):
    plant_id: str
    runs: int = Field(16, ge=4, le=40)


class BriefRequest(BaseModel):
    match_id: str
    side: str = Field("home", pattern="^(home|away)$")
    upto_t: float | None = None
    language: str = "en"


class ScenarioRequest(BaseModel):
    prompt: str = Field(..., min_length=3, max_length=500)


class ForgeConfig(BaseModel):
    home_team_id: str
    away_team_id: str
    seed: int | None = None
    scenario: str = "balanced"
    intensity: float = 0.5
    home_formation: str | None = None
    away_formation: str | None = None
    as_of: str | None = None
