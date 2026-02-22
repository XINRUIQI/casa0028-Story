"""
utils_police.py
---------------
Fetch bicycle theft crime data from the UK Police Open Data API.

Key behaviours:
  - Simplifies Borough polygon to ≤ MAX_POLY_POINTS vertices for the API.
  - If the API returns 503 (area too large), automatically subdivides the
    bounding box into a 2×2 grid and retries each cell, then deduplicates.
  - All responses are cached as JSON files so repeated runs skip API calls.
  - Returns a flat list of incident dicts [{id, lat, lng, date}, ...].
"""

from __future__ import annotations

import json
import time
import logging
from pathlib import Path

import requests
from shapely.geometry import box, shape, mapping
from shapely.ops import unary_union

logger = logging.getLogger(__name__)

POLICE_API_BASE = "https://data.police.uk/api"
MAX_POLY_POINTS = 25      # UK Police API accepts up to 100 points; keep well below
REQUEST_DELAY   = 0.6     # seconds between requests to be polite to the API
MAX_GRID_DEPTH  = 2       # maximum recursion depth when subdividing large areas


# ---------------------------------------------------------------------------
# Polygon helpers
# ---------------------------------------------------------------------------

def _simplify_to_n_points(geom, max_points: int = MAX_POLY_POINTS):
    """Return the exterior ring of a polygon simplified to ≤ max_points vertices."""
    coords = list(geom.exterior.coords)
    if len(coords) <= max_points:
        return coords[:-1]          # drop duplicate closing vertex

    tolerance = 0.0001
    simplified = geom
    for _ in range(30):
        simplified = geom.simplify(tolerance, preserve_topology=True)
        n = len(list(simplified.exterior.coords))
        if n <= max_points:
            break
        tolerance *= 2.0

    return list(simplified.exterior.coords)[:-1]


def _coords_to_api_string(coords) -> str:
    """Convert [(lng, lat), ...] pairs to the API poly string 'lat,lng:lat,lng:...'"""
    return ":".join(f"{lat:.6f},{lng:.6f}" for lng, lat in coords)


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

def _get_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": "BikeCrimeExplorer/1.0 (academic project)"})
    return session


def get_available_months(session: requests.Session = None) -> list[str]:
    """
    Query the API for the list of available data months.
    Returns sorted list of 'YYYY-MM' strings, most recent last.
    """
    if session is None:
        session = _get_session()
    try:
        resp = session.get(f"{POLICE_API_BASE}/crimes-street-dates", timeout=15)
        resp.raise_for_status()
        dates = resp.json()
        months = sorted(d["date"] for d in dates)
        logger.info("Available months: %s … %s (%d total)",
                    months[0], months[-1], len(months))
        return months
    except Exception as exc:
        logger.warning("Could not fetch available months: %s", exc)
        return []


# ---------------------------------------------------------------------------
# Core fetch – single polygon / month
# ---------------------------------------------------------------------------

def _fetch_single_poly(poly_str: str, month: str,
                        cache_path: Path,
                        session: requests.Session) -> list | None:
    """
    Call the API for one polygon + month.
    Returns list of crime dicts, [] on non-503 error, None on 503 (area too big).
    Reads from / writes to cache_path.
    """
    if cache_path.exists():
        with open(cache_path, encoding="utf-8") as f:
            return json.load(f)

    url = f"{POLICE_API_BASE}/crimes-street/bicycle-theft"
    params = {"poly": poly_str, "date": month}

    try:
        resp = session.get(url, params=params, timeout=45)
    except requests.RequestException as exc:
        logger.warning("  Request error (%s %s): %s", month, cache_path.stem, exc)
        return []
    finally:
        time.sleep(REQUEST_DELAY)

    if resp.status_code == 503:
        logger.debug("  503 (area too large) for %s", cache_path.stem)
        return None                  # signal to caller to subdivide

    if resp.status_code != 200:
        logger.warning("  HTTP %d for %s %s", resp.status_code, month, cache_path.stem)
        return []

    crimes = resp.json()
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(crimes, f)
    logger.debug("  Fetched %d crimes for %s %s", len(crimes), month, cache_path.stem)
    return crimes


# ---------------------------------------------------------------------------
# Recursive grid-subdivision fetch
# ---------------------------------------------------------------------------

def _fetch_with_subdivision(geom,
                             month: str,
                             cache_dir: Path,
                             session: requests.Session,
                             depth: int = 0,
                             cell_id: str = "") -> list:
    """
    Fetch crimes for a geometry, subdividing into a 2×2 grid on 503.
    Returns deduplicated list of incident dicts.
    """
    coords = _simplify_to_n_points(geom)
    poly_str = _coords_to_api_string(coords)

    label = cell_id if cell_id else "full"
    cache_path = cache_dir / f"{label}_{month}.json"

    result = _fetch_single_poly(poly_str, month, cache_path, session)

    if result is not None:          # success or non-503 error
        return result

    if depth >= MAX_GRID_DEPTH:
        logger.warning("  Max subdivision depth reached for %s %s – skipping cell",
                       month, label)
        return []

    # Subdivide into 2×2 grid cells
    minx, miny, maxx, maxy = geom.bounds
    midx = (minx + maxx) / 2
    midy = (miny + maxy) / 2
    quadrants = [
        box(minx, midy, midx, maxy),   # NW
        box(midx, midy, maxx, maxy),   # NE
        box(minx, miny, midx, midy),   # SW
        box(midx, miny, maxx, midy),   # SE
    ]
    suffixes = ["NW", "NE", "SW", "SE"]

    all_crimes: list = []
    seen_ids: set = set()

    for quad, suffix in zip(quadrants, suffixes):
        clipped = geom.intersection(quad)
        if clipped.is_empty:
            continue
        sub_id = f"{label}_{suffix}" if cell_id else suffix
        crimes = _fetch_with_subdivision(
            clipped, month, cache_dir, session,
            depth=depth + 1, cell_id=sub_id
        )
        for c in crimes:
            uid = c.get("id") or (c.get("location", {}) or {}).get("street", {}).get("id", "")
            key = (uid, c.get("month", ""))
            if key not in seen_ids:
                seen_ids.add(key)
                all_crimes.append(c)

    # Cache merged result so the top-level call is cached next run
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(all_crimes, f)

    return all_crimes


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def fetch_borough_month(borough_name: str,
                         borough_geom,          # Shapely geometry (WGS84)
                         month: str,            # 'YYYY-MM'
                         cache_dir: Path,
                         session: requests.Session = None) -> list[dict]:
    """
    Fetch all bicycle theft incidents for one Borough and one month.

    Parameters
    ----------
    borough_name : str
        Used only for log messages.
    borough_geom : Shapely Polygon
        Borough boundary in WGS84 (EPSG:4326).
    month : str
        Target month, e.g. '2025-01'.
    cache_dir : Path
        Directory under which per-borough cache files are stored.
    session : requests.Session, optional

    Returns
    -------
    list of dict  – raw crime objects from the UK Police API.
    """
    if session is None:
        session = _get_session()

    borough_cache_dir = cache_dir / borough_name.replace(" ", "_")
    logger.info("  [Police] %s – %s", borough_name, month)

    crimes = _fetch_with_subdivision(
        borough_geom, month, borough_cache_dir, session
    )
    return crimes


def parse_crimes_to_records(crimes: list[dict],
                              borough_gss: str,
                              borough_name: str,
                              month: str) -> list[dict]:
    """
    Extract only the fields we need from raw API crime objects.

    Returns list of minimal dicts:
      {area_id, area_name, month, crime_id, lat, lng}
    """
    records = []
    for c in crimes:
        loc = c.get("location") or {}
        lat_str = loc.get("latitude")
        lng_str = loc.get("longitude")
        try:
            lat = float(lat_str) if lat_str else None
            lng = float(lng_str) if lng_str else None
        except (TypeError, ValueError):
            lat = lng = None

        records.append({
            "area_id":   borough_gss,
            "area_name": borough_name,
            "month":     month,
            "crime_id":  c.get("id", ""),
            "lat":       lat,
            "lng":       lng,
        })
    return records
