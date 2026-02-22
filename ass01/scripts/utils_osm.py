"""
utils_osm.py
------------
Fetch bicycle parking exposure data from OpenStreetMap via the Overpass API.

Strategy
~~~~~~~~
For each London Borough we:
  1. Query Overpass for all nodes/ways tagged amenity=bicycle_parking whose
     centroid falls within the Borough bounding box.
  2. Filter results to points that lie within the actual Borough polygon
     (using Shapely point-in-polygon).
  3. Count the surviving features → exposure (parking_count).
  4. Cache the raw Overpass response per Borough so repeated runs are free.

Overpass endpoint used: https://overpass-api.de/api/interpreter
A public mirror (overpass.kumi.systems) is tried as fallback.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import requests
from shapely.geometry import Point

logger = logging.getLogger(__name__)

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
REQUEST_TIMEOUT = 90   # seconds; Overpass queries can be slow
REQUEST_DELAY   = 2.0  # seconds between requests


# ---------------------------------------------------------------------------
# Overpass query builder
# ---------------------------------------------------------------------------

def _build_query(south: float, west: float, north: float, east: float) -> str:
    """
    Build an Overpass QL query that fetches all bicycle_parking nodes and
    way-centroids within the given bounding box.

    Using 'out center;' for ways so we get a single lat/lng per way.
    """
    bbox = f"{south:.6f},{west:.6f},{north:.6f},{east:.6f}"
    return f"""[out:json][timeout:60];
(
  node["amenity"="bicycle_parking"]({bbox});
  way["amenity"="bicycle_parking"]({bbox});
);
out center;"""


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def _get_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": "BikeCrimeExplorer/1.0 (academic project)"})
    return session


def _query_overpass(query: str, session: requests.Session) -> dict | None:
    """Try each Overpass endpoint in turn; return parsed JSON or None."""
    for endpoint in OVERPASS_ENDPOINTS:
        try:
            resp = session.post(endpoint, data={"data": query}, timeout=REQUEST_TIMEOUT)
            if resp.status_code == 200:
                return resp.json()
            logger.debug("  Overpass %s returned HTTP %d", endpoint, resp.status_code)
        except requests.RequestException as exc:
            logger.debug("  Overpass %s error: %s", endpoint, exc)
        finally:
            time.sleep(REQUEST_DELAY)
    logger.warning("  All Overpass endpoints failed for this query")
    return None


# ---------------------------------------------------------------------------
# Point extraction from Overpass elements
# ---------------------------------------------------------------------------

def _element_to_point(elem: dict) -> Point | None:
    """
    Convert an Overpass element to a Shapely Point.
    - node: use lat/lon directly.
    - way:  use the 'center' lat/lon returned by 'out center;'.
    """
    etype = elem.get("type")
    if etype == "node":
        lat = elem.get("lat")
        lon = elem.get("lon")
    elif etype == "way":
        center = elem.get("center", {})
        lat = center.get("lat")
        lon = center.get("lon")
    else:
        return None

    if lat is None or lon is None:
        return None
    return Point(lon, lat)   # Shapely uses (x=lng, y=lat)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def fetch_borough_parking(borough_name: str,
                           borough_geom,          # Shapely Polygon (WGS84)
                           cache_dir: Path,
                           session: requests.Session = None) -> int:
    """
    Return the number of bicycle_parking features (nodes + ways) within a
    Borough polygon, fetching from Overpass or reading from local cache.

    Parameters
    ----------
    borough_name : str
        Human-readable name, used for cache filename and logging.
    borough_geom : Shapely Polygon
        Borough boundary in WGS84 (EPSG:4326).
    cache_dir : Path
        Directory for Overpass cache files.
    session : requests.Session, optional

    Returns
    -------
    int  – parking feature count (0 if fetch failed).
    """
    if session is None:
        session = _get_session()

    safe_name = borough_name.replace(" ", "_")
    cache_path = cache_dir / f"{safe_name}_parking.json"

    # ---- load from cache ----
    if cache_path.exists():
        with open(cache_path, encoding="utf-8") as f:
            raw = json.load(f)
        logger.info("  [OSM] %s – loaded from cache", borough_name)
    else:
        logger.info("  [OSM] %s – querying Overpass", borough_name)
        minx, miny, maxx, maxy = borough_geom.bounds   # (west, south, east, north)
        query = _build_query(south=miny, west=minx, north=maxy, east=maxx)
        raw = _query_overpass(query, session)

        if raw is None:
            logger.warning("  [OSM] %s – Overpass failed, returning 0", borough_name)
            return 0

        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(raw, f)

    # ---- spatial filter: keep only points inside the Borough polygon ----
    elements = raw.get("elements", [])
    count = 0
    for elem in elements:
        pt = _element_to_point(elem)
        if pt is not None and borough_geom.contains(pt):
            count += 1

    logger.info("  [OSM] %s – %d parking features (after polygon filter)", borough_name, count)
    return count


def fetch_all_boroughs_parking(boroughs_gdf,       # GeoDataFrame, CRS=4326
                                cache_dir: Path,
                                name_col: str = "name") -> dict[str, int]:
    """
    Convenience wrapper: fetch parking counts for every Borough in a
    GeoDataFrame and return a {borough_name: count} dict.

    Parameters
    ----------
    boroughs_gdf : GeoDataFrame
        Must be in WGS84 (EPSG:4326).
    cache_dir : Path
    name_col : str
        Column containing Borough names.

    Returns
    -------
    dict  {borough_name: parking_count}
    """
    session = _get_session()
    results: dict[str, int] = {}

    for _, row in boroughs_gdf.iterrows():
        name  = row[name_col]
        geom  = row.geometry
        count = fetch_borough_parking(name, geom, cache_dir, session)
        results[name] = count

    return results
