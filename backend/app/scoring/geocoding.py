"""Google Geocoding API client, biased to the Davis bbox."""

from __future__ import annotations

from dataclasses import dataclass

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import settings

GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"


@dataclass
class GeocodeResult:
    lat: float
    lon: float
    formatted_address: str


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=8))
def geocode(client: httpx.Client, query: str) -> GeocodeResult | None:
    n, s, e, w = settings.bbox
    resp = client.get(
        GEOCODE_URL,
        params={
            "address": query,
            # bounds: south,west|north,east — biases (does not restrict) results to Davis.
            "bounds": f"{s},{w}|{n},{e}",
            "region": "us",
            "key": settings.google_maps_api_key,
        },
        timeout=10.0,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("status") != "OK" or not data.get("results"):
        return None
    top = data["results"][0]
    loc = top["geometry"]["location"]
    return GeocodeResult(
        lat=float(loc["lat"]),
        lon=float(loc["lng"]),
        formatted_address=top.get("formatted_address", query),
    )
