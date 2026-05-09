"""Gemini 2.5 Flash safety scorer.

Two scoring modes:
  - score_segment_images: edge-segment safety (forward + side images of a road)
  - score_intersection_images: how scary an intersection is to cross (4 cardinal views)
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

SEGMENT_SYSTEM_PROMPT = """You are a cycling safety analyst. You will be shown one or more Google \
Street View images captured at a single point along a road segment, from different headings \
(typically a forward view and a side view of the road shoulder). Treat them as a panorama of the \
same location and produce ONE combined safety score for a cyclist riding this segment.

Consider, in roughly this order:
- Bike infrastructure: presence and protection of bike lanes (none / painted / buffered / protected)
- Traffic stress: number of lanes, road width, apparent speed limit, traffic volume cues
- Door zone: parked cars adjacent to the cycling path (look hard at side views)
- Surface: potholes, cracking, debris, gravel, drainage grates
- Sight lines: blind curves, parked vehicles obscuring driveways
- General feel: residential street vs arterial vs industrial frontage

Score from 1 (extremely dangerous — only experts would ride here) to 10 (separated bike path or \
quiet neighborhood street, safe for a child). Calibrate around 5 = a typical urban arterial with \
a painted bike lane.

If all images are indoors, blank, or otherwise unusable, return score=null and put "unusable_image" \
in hazards.
"""

INTERSECTION_SYSTEM_PROMPT = """You are a cycling safety analyst evaluating a road INTERSECTION. \
You will be shown 4 Google Street View images (cardinal directions: north, east, south, west) \
captured AT the intersection. Score how dangerous this intersection is for a cyclist to traverse \
straight through, turn at, or wait at.

Consider:
- Number and width of crossing lanes; presence of slip lanes (right-turn lanes that bypass the signal)
- Signal type: traffic light vs stop signs vs uncontrolled
- Bike-specific infrastructure: bike box, advance stop line, dedicated signal, marked crossings
- Sight lines: parked cars, vegetation, or buildings hiding cross-traffic
- Turn-conflict potential: high-speed right-turning cars crossing bike paths
- Pedestrian density (more peds → typically slower, safer for bikes)
- Visibility / lighting cues for low-light safety

Score from 1 (avoid at all costs — high-speed multi-lane uncontrolled mess) to 10 (low-stress: \
quiet 4-way stop or bike-prioritized intersection). Calibrate 5 = signalized arterial intersection \
with painted bike lane crossings.

If images are unusable, return score=null with "unusable_image" in hazards.
"""

SEGMENT_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "score": {"type": "integer", "minimum": 1, "maximum": 10, "nullable": True},
        "infrastructure": {
            "type": "string",
            "enum": ["none", "painted_lane", "buffered_lane", "protected_lane",
                     "shared_path", "off_street_path", "unknown"],
        },
        "hazards": {"type": "array", "items": {"type": "string"}},
        "reasons": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["score", "infrastructure", "hazards", "reasons"],
}

INTERSECTION_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "score": {"type": "integer", "minimum": 1, "maximum": 10, "nullable": True},
        "control": {
            "type": "string",
            "enum": ["uncontrolled", "yield", "stop", "all_way_stop",
                     "signal", "signal_with_bike_phase", "roundabout", "unknown"],
        },
        "hazards": {"type": "array", "items": {"type": "string"}},
        "reasons": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["score", "control", "hazards", "reasons"],
}


@dataclass
class SegmentAssessment:
    score: int | None
    infrastructure: str
    hazards: list[str]
    reasons: list[str]
    raw: dict


@dataclass
class IntersectionAssessment:
    score: int | None
    control: str
    hazards: list[str]
    reasons: list[str]
    raw: dict


def make_client() -> genai.Client:
    return genai.Client(api_key=settings.gemini_api_key)


def _image_parts(image_paths: list[Path]) -> list:
    parts = []
    for p in image_paths:
        parts.append(types.Part.from_bytes(data=p.read_bytes(), mime_type="image/jpeg"))
    return parts


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def score_segment_images(client: genai.Client, image_paths: list[Path]) -> SegmentAssessment:
    if not image_paths:
        raise ValueError("score_segment_images requires at least one image")
    parts = _image_parts(image_paths)
    response = client.models.generate_content(
        model=MODEL,
        contents=[
            *parts,
            f"Score this road segment for cyclist safety per the system instructions. "
            f"({len(image_paths)} image(s) of the same location.)",
        ],
        config=types.GenerateContentConfig(
            system_instruction=SEGMENT_SYSTEM_PROMPT,
            response_mime_type="application/json",
            response_schema=SEGMENT_RESPONSE_SCHEMA,
            temperature=0.2,
        ),
    )
    parsed = json.loads(response.text or "{}")
    return SegmentAssessment(
        score=parsed.get("score"),
        infrastructure=parsed.get("infrastructure", "unknown"),
        hazards=parsed.get("hazards", []) or [],
        reasons=parsed.get("reasons", []) or [],
        raw=parsed,
    )


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def score_intersection_images(client: genai.Client, image_paths: list[Path]) -> IntersectionAssessment:
    if not image_paths:
        raise ValueError("score_intersection_images requires at least one image")
    parts = _image_parts(image_paths)
    response = client.models.generate_content(
        model=MODEL,
        contents=[
            *parts,
            f"Score this intersection for cyclist safety per the system instructions. "
            f"({len(image_paths)} image(s), cardinal-direction views.)",
        ],
        config=types.GenerateContentConfig(
            system_instruction=INTERSECTION_SYSTEM_PROMPT,
            response_mime_type="application/json",
            response_schema=INTERSECTION_RESPONSE_SCHEMA,
            temperature=0.2,
        ),
    )
    parsed = json.loads(response.text or "{}")
    return IntersectionAssessment(
        score=parsed.get("score"),
        control=parsed.get("control", "unknown"),
        hazards=parsed.get("hazards", []) or [],
        reasons=parsed.get("reasons", []) or [],
        raw=parsed,
    )
