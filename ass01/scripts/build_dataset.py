"""
build_dataset.py
----------------
Main pipeline script.  Run this to produce all three output files that the
React front-end consumes:

    data/output/areas.geojson     – simplified Borough boundaries
    data/output/features.json     – month × Borough panel with all metrics
    data/output/meta.json         – month list, area list, field descriptions

Usage
-----
    # from the ass01/ project root:
    python scripts/build_dataset.py

Optional flags
    --months  12          number of latest available months to include (default 12)
    --spike   0.5         spike alert threshold, fraction (default 0.5 = 50 %)
    --no-osm              skip OSM fetch and use cached values only (or zeros)
    --dry-run             resolve months and boroughs but make no API calls
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

# ── locate project root regardless of where the script is invoked from ──────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_RAW     = PROJECT_ROOT / "data" / "raw"
DATA_CACHE   = PROJECT_ROOT / "data" / "cache"
DATA_OUTPUT  = PROJECT_ROOT / "data" / "output"

BOROUGHS_FILE = DATA_RAW / "London_Boroughs.gpkg"

sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
from utils_police import (
    get_available_months,
    fetch_borough_month,
    parse_crimes_to_records,
)
from utils_osm    import fetch_all_boroughs_parking
from utils_alerts import enrich_panel, alert_summary, SPIKE_THRESHOLD


# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Step 1 – Load and prepare Borough boundaries
# ---------------------------------------------------------------------------

def load_boroughs(gpkg_path: Path = BOROUGHS_FILE) -> gpd.GeoDataFrame:
    """
    Load London Boroughs from the .gpkg file, reproject to WGS84.
    Returns GeoDataFrame sorted by gss_code with simplified geometry
    written to a 'geom_simple' column (for API use) and original geometry
    retained in 'geometry' (for output).
    """
    logger.info("Loading Borough boundaries from %s", gpkg_path)
    gdf = gpd.read_file(gpkg_path).to_crs(epsg=4326)
    gdf = gdf.sort_values("gss_code").reset_index(drop=True)

    # Simplify geometry for the areas.geojson output (reduce file size)
    # tolerance in degrees; ~0.0005° ≈ 50 m
    gdf["geometry"] = gdf["geometry"].simplify(0.0005, preserve_topology=True)

    logger.info("  %d Boroughs loaded", len(gdf))
    return gdf


# ---------------------------------------------------------------------------
# Step 2 – Resolve which months to fetch
# ---------------------------------------------------------------------------

def resolve_months(n_months: int) -> list[str]:
    """
    Ask the UK Police API for available months and return the last n_months.
    Falls back to a hard-coded list if the API is unreachable.
    """
    import requests
    session = requests.Session()
    session.headers.update({"User-Agent": "BikeCrimeExplorer/1.0"})

    available = get_available_months(session)

    if not available:
        logger.warning("Could not reach UK Police API – generating fallback month list")
        # Build last n_months from today's date (as a best-effort fallback)
        from dateutil.relativedelta import relativedelta
        today = datetime.now()
        # Police data usually lags by ~2 months
        latest = today.replace(day=1) - relativedelta(months=2)
        available = [
            (latest - relativedelta(months=i)).strftime("%Y-%m")
            for i in range(n_months - 1, -1, -1)
        ]
        logger.warning("  Fallback months: %s … %s", available[0], available[-1])
        return available

    selected = available[-n_months:]
    logger.info("Selected months: %s … %s (%d)", selected[0], selected[-1], len(selected))
    return selected


# ---------------------------------------------------------------------------
# Step 3 – Fetch crime data (Police API)
# ---------------------------------------------------------------------------

def fetch_all_crimes(gdf: gpd.GeoDataFrame,
                     months: list[str],
                     cache_dir: Path,
                     dry_run: bool = False) -> pd.DataFrame:
    """
    For every Borough × month combination, fetch bicycle theft incidents and
    aggregate to a theft_count per (area_id, month) row.

    Returns a DataFrame with columns: area_id, area_name, month, theft_count.
    """
    import requests
    session = requests.Session()
    session.headers.update({"User-Agent": "BikeCrimeExplorer/1.0"})

    police_cache = cache_dir / "police"
    all_records: list[dict] = []

    total_combos = len(gdf) * len(months)
    done = 0

    for _, row in gdf.iterrows():
        gss       = row["gss_code"]
        name      = row["name"]
        geom      = row["geometry"]

        for month in months:
            done += 1
            pct = done / total_combos * 100
            logger.info("[%3.0f%%] %s – %s", pct, name, month)

            if dry_run:
                all_records.append({"area_id": gss, "area_name": name,
                                    "month": month, "theft_count": 0})
                continue

            crimes = fetch_borough_month(name, geom, month, police_cache, session)
            records = parse_crimes_to_records(crimes, gss, name, month)
            all_records.extend(records)

    if not all_records:
        return pd.DataFrame(columns=["area_id", "area_name", "month", "theft_count"])

    df = pd.DataFrame(all_records)

    # Aggregate to (area_id, month) counts
    agg = (
        df.groupby(["area_id", "area_name", "month"])
        .size()
        .reset_index(name="theft_count")
    )
    return agg


# ---------------------------------------------------------------------------
# Step 4 – Fetch OSM exposure data
# ---------------------------------------------------------------------------

def fetch_exposure(gdf: gpd.GeoDataFrame,
                   cache_dir: Path,
                   skip_osm: bool = False) -> dict[str, int]:
    """
    Return {gss_code: parking_count} for each Borough.
    If skip_osm=True, returns zeros (useful when cache already populated).
    """
    osm_cache = cache_dir / "osm"

    if skip_osm:
        logger.info("--no-osm flag set: using cached OSM data only")
        # Try to read from cache; fall back to 0
        result: dict[str, int] = {}
        for _, row in gdf.iterrows():
            safe = row["name"].replace(" ", "_")
            cp   = osm_cache / f"{safe}_parking.json"
            if cp.exists():
                with open(cp) as f:
                    raw = json.load(f)
                from shapely.geometry import Point
                count = sum(
                    1 for e in raw.get("elements", [])
                    if _elem_to_point(e) is not None
                    and row["geometry"].contains(_elem_to_point(e))
                )
                result[row["gss_code"]] = count
            else:
                result[row["gss_code"]] = 0
        return result

    logger.info("Fetching OSM bicycle_parking counts for all %d Boroughs", len(gdf))
    name_to_count = fetch_all_boroughs_parking(gdf, osm_cache, name_col="name")

    # Map name → gss_code
    name_to_gss = dict(zip(gdf["name"], gdf["gss_code"]))
    return {name_to_gss[n]: c for n, c in name_to_count.items()}


def _elem_to_point(elem):
    """Minimal helper used in the skip_osm path above."""
    from shapely.geometry import Point
    t = elem.get("type")
    if t == "node":
        lat, lon = elem.get("lat"), elem.get("lon")
    elif t == "way":
        c = elem.get("center", {})
        lat, lon = c.get("lat"), c.get("lon")
    else:
        return None
    if lat is None or lon is None:
        return None
    return Point(lon, lat)


# ---------------------------------------------------------------------------
# Step 5 – Assemble full panel
# ---------------------------------------------------------------------------

def build_panel(crime_df: pd.DataFrame,
                gdf: gpd.GeoDataFrame,
                months: list[str],
                exposure_map: dict[str, int]) -> pd.DataFrame:
    """
    Create a complete (area_id × month) Cartesian product and fill in
    theft_count and exposure for every cell.
    """
    area_rows = [
        {"area_id": row["gss_code"], "area_name": row["name"]}
        for _, row in gdf.iterrows()
    ]
    index_df = pd.DataFrame(
        [(a["area_id"], a["area_name"], m)
         for a in area_rows
         for m in months],
        columns=["area_id", "area_name", "month"],
    )

    # Left-join crime counts (missing → 0)
    panel = index_df.merge(
        crime_df[["area_id", "month", "theft_count"]],
        on=["area_id", "month"],
        how="left",
    )
    panel["theft_count"] = panel["theft_count"].fillna(0).astype(int)

    # Attach exposure from OSM map (same value every month for a Borough)
    panel["exposure"] = panel["area_id"].map(exposure_map).fillna(0).astype(int)

    return panel.sort_values(["area_id", "month"]).reset_index(drop=True)


# ---------------------------------------------------------------------------
# Step 6 – Export outputs
# ---------------------------------------------------------------------------

def export_areas_geojson(gdf: gpd.GeoDataFrame, out_dir: Path) -> Path:
    """Write simplified Borough boundaries as GeoJSON (only id + name)."""
    out_path = out_dir / "areas.geojson"
    export_gdf = gdf[["gss_code", "name", "geometry"]].rename(
        columns={"gss_code": "area_id", "name": "area_name"}
    )
    export_gdf.to_file(out_path, driver="GeoJSON")
    size_kb = out_path.stat().st_size / 1024
    logger.info("Wrote areas.geojson  (%.1f KB)", size_kb)
    return out_path


def export_features_json(panel: pd.DataFrame, out_dir: Path) -> Path:
    """
    Write the enriched panel to features.json.

    NaN values are converted to null so JSON is valid.
    Float columns are rounded to 4 decimal places to keep file size reasonable.
    """
    out_path = out_dir / "features.json"

    # Round floats
    for col in ["risk_ratio", "city_mean_ratio", "risk_index"]:
        if col in panel.columns:
            panel[col] = panel[col].round(4)

    # Convert bool columns so JSON serialisation is clean
    for col in ["valid_exposure", "stability_flag", "alert_spike", "alert_trend3"]:
        if col in panel.columns:
            panel[col] = panel[col].astype(bool)

    records = json.loads(
        panel.to_json(orient="records", force_ascii=False)
    )
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, allow_nan=False,
                  default=lambda x: None)   # NaN → null

    size_kb = out_path.stat().st_size / 1024
    logger.info("Wrote features.json  (%.1f KB, %d rows)", size_kb, len(panel))
    return out_path


def export_meta_json(gdf: gpd.GeoDataFrame,
                     months: list[str],
                     spike_threshold: float,
                     out_dir: Path) -> Path:
    """Write meta.json with month list, area index, field descriptions."""
    out_path = out_dir / "meta.json"

    areas = [
        {"id": row["gss_code"], "name": row["name"]}
        for _, row in gdf.sort_values("name").iterrows()
    ]

    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "months": months,
        "areas": areas,
        "thresholds": {
            "stability_min_exposure": 10,
            "spike_threshold": spike_threshold,
            "baseline_window_months": 6,
        },
        "fields": {
            "area_id":         "Borough GSS code (e.g. E09000001)",
            "area_name":       "Borough display name",
            "month":           "YYYY-MM",
            "theft_count":     "Number of bicycle theft incidents recorded by UK Police",
            "exposure":        "Number of bicycle_parking features in the Borough (OSM)",
            "valid_exposure":  "False when exposure == 0 (risk metrics unreliable)",
            "risk_ratio":      "theft_count / exposure",
            "city_mean_ratio": "Mean risk_ratio across all valid Boroughs that month",
            "risk_index":      "risk_ratio / city_mean_ratio  (city baseline = 1.0)",
            "stability_flag":  "True when exposure < 10 (interpret with caution)",
            "alert_spike":     "True when risk_index > 6-month rolling mean × (1 + spike_threshold)",
            "alert_trend3":    "True when risk_index rose for 3 consecutive months",
            "alert_level":     "none | watch (1 flag) | warning (2 flags)",
        },
        "data_sources": {
            "crimes":     "UK Police Open Data API  –  https://data.police.uk/docs/",
            "exposure":   "OpenStreetMap via Overpass API  –  https://overpass-api.de/",
            "boundaries": "London Datastore (GLA) – London Boroughs GeoPackage",
            "license":    "OGL v3 (Police data) | ODbL 1.0 (OSM) | OGL v3 (GLA boundaries)",
        },
    }

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    logger.info("Wrote meta.json")
    return out_path


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def parse_args():
    parser = argparse.ArgumentParser(
        description="Build the bike-theft risk dataset for the London explorer."
    )
    parser.add_argument("--months",   type=int,   default=12,
                        help="Number of latest months to include (default 12)")
    parser.add_argument("--spike",    type=float, default=SPIKE_THRESHOLD,
                        help="Spike alert threshold as a fraction (default 0.5)")
    parser.add_argument("--no-osm",   action="store_true",
                        help="Skip Overpass fetch; use cached OSM data or zeros")
    parser.add_argument("--dry-run",  action="store_true",
                        help="Resolve months and boroughs but make no API calls")
    return parser.parse_args()


def main():
    args = parse_args()
    DATA_OUTPUT.mkdir(parents=True, exist_ok=True)

    # 1 – Boundaries
    gdf = load_boroughs()

    # 2 – Months
    months = resolve_months(args.months)

    if args.dry_run:
        logger.info("DRY RUN – would process %d boroughs × %d months = %d combos",
                    len(gdf), len(months), len(gdf) * len(months))
        logger.info("Months: %s … %s", months[0], months[-1])
        return

    # 3 – Crimes
    logger.info("=" * 60)
    logger.info("STEP 3 / 6  Fetching crime data (%d borough × month combos)",
                len(gdf) * len(months))
    crime_df = fetch_all_crimes(gdf, months, DATA_CACHE)
    logger.info("  Total incident-level records fetched: %d", len(crime_df))

    # 4 – OSM exposure
    logger.info("=" * 60)
    logger.info("STEP 4 / 6  Fetching OSM exposure data")
    exposure_map = fetch_exposure(gdf, DATA_CACHE, skip_osm=args.no_osm)
    logger.info("  Exposure map: min=%d max=%d",
                min(exposure_map.values()), max(exposure_map.values()))

    # 5 – Assemble + enrich
    logger.info("=" * 60)
    logger.info("STEP 5 / 6  Building and enriching panel")
    from utils_alerts import enrich_panel, alert_summary
    panel = build_panel(crime_df, gdf, months, exposure_map)
    panel = enrich_panel(panel, spike_threshold=args.spike)
    logger.info("  Panel shape: %s", panel.shape)
    logger.info("  Alert summary: %s", alert_summary(panel))

    # 6 – Export
    logger.info("=" * 60)
    logger.info("STEP 6 / 6  Exporting output files")
    export_areas_geojson(gdf, DATA_OUTPUT)
    export_features_json(panel, DATA_OUTPUT)
    export_meta_json(gdf, months, args.spike, DATA_OUTPUT)

    logger.info("=" * 60)
    logger.info("Done.  Output written to: %s", DATA_OUTPUT)
    logger.info("Next: copy data/output/ → web/public/data/")


if __name__ == "__main__":
    main()
