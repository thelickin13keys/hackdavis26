"""Gemini 2.5 Flash safety scorer.

Sends a Street View image to Gemini and asks for a structured JSON safety
assessment for cyclists. Uses response_mime_type='application/json' with a
schema so we don't have to parse loose text.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from google import genai
from google.genai import types
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import settings

MODEL = "gemini-2.5-flash"

SYSTEM_PROMPT = """You are a cycling safety analyst. You will be shown a Google Street View image \
captured along a road segment. Your job is to rate how safe this segment looks for a cyclist riding \
in regular street clothes (not a confident lycra-wearing roadie).

Consider, in roughly this order:
- Bike infrastructure: presence and protection of bike lanes (none / painted / buffered / protected)
- Traffic stress: number of lanes, road width, apparent speed limit, traffic volume cues
- Door zone: parked cars adjacent to the cycling path
- Surface: potholes, cracking, debris, gravel, drainage grates
- Sight lines: blind curves, parked vehicles obscuring driveways
- Intersection complexity: stop signs, signals, turn lanes, slip lanes
- General "feel": residential street vs arterial vs industrial frontage

Score from 1 (extremely dangerous — only experts would ride here) to 10 (separated bike path or \
quiet neighborhood street, safe for a child). Calibrate around 5 = a typical urban arterial with \
a painted bike lane.

If the image is indoors, blank, or otherwise unusable, return score=null and put "unusable_image" \
in hazards.
"""

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "score": {
            "type": "integer",
            "minimum": 1,
            "maximum": 10,
            "nullable": True,
            "description": "Overall cyclist safety score (1=worst, 10=best)",
        },
        "infrastructure": {
            "type": "string",
            "enum": ["none", "painted_lane", "buffered_lane", "protected_lane", "shared_path", "off_street_path", "unknown"],
        },
        "hazards": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Short tags for specific hazards observed (e.g. door_zone, fast_traffic, broken_pavement, blind_corner)",
        },
        "reasons": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Brief sentences explaining the score",
        },
    },
    "required": ["score", "infrastructure", "hazards", "reasons"],
}


@dataclass
class SafetyAssessment:
    score: int | None
    infrastructure: str
    hazards: list[str]
    reasons: list[str]
    raw: dict


def make_client() -> genai.Client:
    return genai.Client(api_key=settings.gemini_api_key)


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def score_image(client: genai.Client, image_path: Path) -> SafetyAssessment:
    img_bytes = image_path.read_bytes()
    response = client.models.generate_content(
        model=MODEL,
        contents=[
            types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"),
            "Score this Street View image for cyclist safety per the system instructions.",
        ],
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            response_mime_type="application/json",
            response_schema=RESPONSE_SCHEMA,
            temperature=0.2,
        ),
    )
    text = response.text or "{}"
    parsed = json.loads(text)
    return SafetyAssessment(
        score=parsed.get("score"),
        infrastructure=parsed.get("infrastructure", "unknown"),
        hazards=parsed.get("hazards", []) or [],
        reasons=parsed.get("reasons", []) or [],
        raw=parsed,
    )
