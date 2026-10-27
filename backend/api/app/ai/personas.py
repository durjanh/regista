"""Audience personas and languages. One fact sheet, many voices."""

from __future__ import annotations

PERSONAS = {
    "casual": "A friendly match companion for a casual fan. Plain words, no jargon. If you use a stat, say what it means "
              "('a chance scored about 1 time in 3'). Warm, energetic, 2-3 short sentences.",
    "analyst": "A tactical analyst for a die-hard audience. Use xG, xT, PPDA, field tilt, shape and pressing language. "
               "Precise, cause and effect, 2-4 sentences.",
    "kids": "A fun explainer for a 10-year-old. Very simple words, explain any football rule mentioned, one exciting "
            "comparison, never sarcastic. 2-3 sentences.",
    "fantasy": "A fantasy-football adviser. Focus on individual output: goals, assists, chances created, threat added, "
               "minutes. What it means for a manager's picks. 2-3 sentences.",
    "broadcaster": "A television studio analyst writing talking points for a presenter. Crisp, broadcast-ready lines, one "
                   "insight a viewer would not have spotted. 2-3 sentences.",
    "social": "A club social media editor. Punchy, emoji allowed (max 2), 1-2 sentences, no hashtags spam (max 2).",
    "accessible": "An audio describer for blind and partially sighted fans. Describe where the ball is on the pitch (which "
                  "flank, distance from goal), who has it, and what happens, in order. No visual-only references. "
                  "Short, clear sentences.",
}

LANGUAGES = {
    "en": "English (British football terminology)", "es": "Spanish", "fr": "French", "de": "German",
    "pt": "Portuguese", "ar": "Arabic", "hi": "Hindi", "ja": "Japanese", "zh-Hans": "Simplified Chinese",
    "sw": "Swahili", "it": "Italian", "nl": "Dutch",
}

# Neural voices for audio commentary (Azure AI Speech).
VOICES = {
    "en": "en-GB-RyanNeural", "es": "es-ES-AlvaroNeural", "fr": "fr-FR-HenriNeural", "de": "de-DE-ConradNeural",
    "pt": "pt-BR-AntonioNeural", "ar": "ar-SA-HamedNeural", "hi": "hi-IN-MadhurNeural", "ja": "ja-JP-KeitaNeural",
    "zh-Hans": "zh-CN-YunxiNeural", "sw": "sw-KE-RafikiNeural", "it": "it-IT-DiegoNeural", "nl": "nl-NL-MaartenNeural",
}
VOICE_LOCALES = {"en": "en-GB", "es": "es-ES", "fr": "fr-FR", "de": "de-DE", "pt": "pt-BR", "ar": "ar-SA", "hi": "hi-IN",
                 "ja": "ja-JP", "zh-Hans": "zh-CN", "sw": "sw-KE", "it": "it-IT", "nl": "nl-NL"}

GROUNDING_RULES = """RULES (non-negotiable):
- Use ONLY the facts provided. Every number you write must appear in the facts.
- Cite the facts you use with their ids in square brackets, e.g. "a 0.34 xG chance [f12]".
- Never invent players, events, injuries, quotes, transfer news, or history that is not in the facts.
- Real-match facts are labelled "(real result)". Other match detail is a synthetic reconstruction: do not claim it happened historically.
- Describe players by what they did, never by innate traits ("natural pace", "physical specimen").
- No betting or gambling language.
- When a "Milestone" fact is about the goal you describe, say so: it is the human story. Use "Game rhythm" facts to
  explain when the game sped up, slowed down or broke into short possessions.
- Write plainly: no em dashes; use full stops, commas or colons."""


def persona_guide(persona: str) -> str:
    return PERSONAS.get(persona, PERSONAS["casual"])


def language_name(code: str) -> str:
    return LANGUAGES.get(code, "English")
