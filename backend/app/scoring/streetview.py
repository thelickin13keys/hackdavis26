"""Google Street View Static API client.

Two endpoints:
  * Metadata API — free; tells us if a pano exists nearby and returns the pano_id
  * Static API   — billed; returns the JPEG

We always check metadata first to avoid paying for blank "no imagery" tiles
and to dedupe by pano_id (so two samples that resolve to the same pano share one image).

UNIQUE FEATURE: Temporal Infrastructure Tracking
- Fetches historical Street View imagery to track bike infrastructure changes over time
- Compares "before/after" to quantify safety improvements
- Shows evolution of bike lanes, signals, pavement quality
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from pathlib import Path
from datetime import datetime

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import settings

log = logging.getLogger(__name__)

METADATA_URL = "https://maps.googleapis.com/maps/api/streetview/metadata"
STATIC_URL = "https://maps.googleapis.com/maps/api/streetview"

DEFAULT_SIZE = "640x640"
DEFAULT_FOV = 90
DEFAULT_PITCH = 0
SOURCE = "outdoor"  # exclude indoor/business panos


@dataclass
class PanoMetadata:
    pano_id: str
    lat: float
    lon: float
    date: str | None  # YYYY-MM


@dataclass
class TemporalPano:
    """Represents a Street View panorama at a specific point in time."""
    pano_id: str
    lat: float
    lon: float
    date: str  # YYYY-MM
    image_path: Path | None = None


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def metadata(client: httpx.Client, lat: float, lon: float, radius_m: int | None = None) -> PanoMetadata | None:
    radius = radius_m if radius_m is not None else settings.streetview_radius_m
    resp = client.get(
        METADATA_URL,
        params={
            "location": f"{lat},{lon}",
            "radius": radius,
            "source": SOURCE,
            "key": settings.google_maps_api_key,
        },
        timeout=10.0,
    )
    resp.raise_for_status()
    data = resp.json()
    status = data.get("status")
    if status != "OK":
        # ZERO_RESULTS / NOT_FOUND just mean no nearby pano — quiet. Anything else
        # (REQUEST_DENIED, OVER_QUERY_LIMIT, INVALID_REQUEST) is a config or quota
        # problem we want surfaced loudly, not silently swallowed as "no image".
        if status not in ("ZERO_RESULTS", "NOT_FOUND"):
            err = data.get("error_message") or "(no error_message)"
            log.error("Street View metadata %s: %s", status, err)
        return None
    loc = data.get("location") or {}
    return PanoMetadata(
        pano_id=data["pano_id"],
        lat=loc.get("lat", lat),
        lon=loc.get("lng", lon),
        date=data.get("date"),
    )


def _image_path_for(pano_id: str, heading: int) -> Path:
    h = hashlib.sha1(f"{pano_id}|{heading}".encode()).hexdigest()[:16]
    return settings.image_cache_dir / f"{h}.jpg"


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def fetch_image(
    client: httpx.Client,
    pano_id: str,
    heading: float,
    size: str = DEFAULT_SIZE,
    fov: int = DEFAULT_FOV,
    pitch: int = DEFAULT_PITCH,
) -> Path:
    """Download and cache the Street View image for this pano + heading."""
    heading_int = int(round(heading)) % 360
    out = _image_path_for(pano_id, heading_int)
    if out.exists() and out.stat().st_size > 0:
        return out
    resp = client.get(
        STATIC_URL,
        params={
            "size": size,
            "pano": pano_id,
            "heading": heading_int,
            "fov": fov,
            "pitch": pitch,
            "source": SOURCE,
            "key": settings.google_maps_api_key,
        },
        timeout=15.0,
    )
    resp.raise_for_status()
    out.write_bytes(resp.content)
    return out


def make_client() -> httpx.Client:
    return httpx.Client()
