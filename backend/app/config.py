from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    google_maps_api_key: str = ""
    gemini_api_key: str = ""
    # Default to Gemini 3 Flash (preview) for stronger object detection.
    # Override via GEMINI_MODEL env if it gets rate-limited or deprecated.
    gemini_model: str = "gemini-3-flash-preview"

    davis_bbox_north: float = 38.580
    davis_bbox_south: float = 38.520
    davis_bbox_east: float = -121.690
    davis_bbox_west: float = -121.790

    sample_interval_m: float = 80.0
    # Search radius (meters) for the SV Metadata API. Davis has lots of greenbelt
    # bike paths where the closest SV pano sits on a parallel road 60–100m away,
    # so 100 catches them while staying close enough to be representative.
    streetview_radius_m: int = 100
    safety_lambda: float = 0.5
    # Penalty added to an edge's safe-cost when entering a scary intersection.
    # Effective cost addend = intersection_penalty_m × (10 − intersection_score) / 9.
    # Default: a score-1 intersection adds 60m of "felt distance" to the entering edge.
    intersection_penalty_m: float = 60.0

    db_path: Path = Path("./data/safebike.db")
    image_cache_dir: Path = Path("./data/images")

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        # (north, south, east, west) — OSMnx convention
        return (
            self.davis_bbox_north,
            self.davis_bbox_south,
            self.davis_bbox_east,
            self.davis_bbox_west,
        )


settings = Settings()
settings.db_path.parent.mkdir(parents=True, exist_ok=True)
settings.image_cache_dir.mkdir(parents=True, exist_ok=True)
