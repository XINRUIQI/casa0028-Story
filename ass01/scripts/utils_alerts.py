"""
utils_alerts.py
---------------
Calculate risk metrics and temporal alert flags for the month × Borough panel.

Input
~~~~~
A pandas DataFrame with at minimum these columns:
    area_id        str   – Borough GSS code
    area_name      str   – Borough display name
    month          str   – 'YYYY-MM'
    theft_count    int   – number of bicycle theft incidents
    exposure       int   – number of bicycle parking features (OSM)

Output
~~~~~~
The same DataFrame with the following columns added (in-place):
    valid_exposure   bool   – False when exposure == 0 (division impossible)
    risk_ratio       float  – theft_count / exposure  (NaN when not valid)
    city_mean_ratio  float  – mean risk_ratio across all Boroughs that month
                              (excludes rows where valid_exposure is False)
    risk_index       float  – risk_ratio / city_mean_ratio  (NaN when not valid)
    stability_flag   bool   – True when exposure < STABILITY_MIN_EXPOSURE
    alert_spike      bool   – True when risk_index > 6-month baseline × (1 + threshold)
    alert_trend3     bool   – True when risk_index rose for 3 consecutive months
    alert_level      str    – 'none' | 'watch' | 'warning'
                              watch    = one flag triggered
                              warning  = both flags triggered
"""

import numpy as np
import pandas as pd

# ── tuneable constants ─────────────────────────────────────────────────────
STABILITY_MIN_EXPOSURE = 10   # Boroughs with fewer parking spots than this
                               # get stability_flag=True ("interpret with caution")
SPIKE_THRESHOLD        = 0.50  # 50 % above 6-month baseline triggers alert_spike
BASELINE_WINDOW        = 6     # months of history used to compute the baseline


# ---------------------------------------------------------------------------
# Step 1 – risk_ratio and risk_index
# ---------------------------------------------------------------------------

def add_risk_metrics(df: pd.DataFrame) -> pd.DataFrame:
    """
    Add valid_exposure, risk_ratio, city_mean_ratio, risk_index,
    and stability_flag columns.

    Operates on a copy; returns the enriched DataFrame.
    The DataFrame must already be sorted by (area_id, month) or
    the function will sort it internally.
    """
    df = df.copy()

    # Ensure consistent sort so window calculations below are correct
    df = df.sort_values(["area_id", "month"]).reset_index(drop=True)

    # ---- basic validity ----
    df["valid_exposure"] = df["exposure"] > 0
    df["stability_flag"] = df["exposure"] < STABILITY_MIN_EXPOSURE

    # ---- risk_ratio ----
    df["risk_ratio"] = np.where(
        df["valid_exposure"],
        df["theft_count"] / df["exposure"],
        np.nan,
    )

    # ---- city_mean_ratio: per-month mean over valid Boroughs ----
    city_mean = (
        df[df["valid_exposure"]]
        .groupby("month")["risk_ratio"]
        .mean()
        .rename("city_mean_ratio")
    )
    df = df.merge(city_mean, on="month", how="left")

    # ---- risk_index ----
    df["risk_index"] = np.where(
        df["valid_exposure"] & (df["city_mean_ratio"] > 0),
        df["risk_ratio"] / df["city_mean_ratio"],
        np.nan,
    )

    return df


# ---------------------------------------------------------------------------
# Step 2 – temporal alert flags
# ---------------------------------------------------------------------------

def _spike_flag(series: pd.Series,
                window: int   = BASELINE_WINDOW,
                threshold: float = SPIKE_THRESHOLD) -> pd.Series:
    """
    For a single Borough's time-sorted risk_index series, return a boolean
    Series where True means the value is > baseline * (1 + threshold).

    baseline for month t = mean of t-window … t-1 (rolling, min_periods=3).
    """
    baseline = series.shift(1).rolling(window=window, min_periods=3).mean()
    return series > baseline * (1 + threshold)


def _trend3_flag(series: pd.Series) -> pd.Series:
    """
    Return True for month t when risk_index[t-2] < risk_index[t-1] < risk_index[t].
    Requires at least 3 valid observations; otherwise False.
    """
    s1 = series.shift(1)   # t-1
    s2 = series.shift(2)   # t-2
    return (series > s1) & (s1 > s2)


def add_alert_flags(df: pd.DataFrame,
                    spike_threshold: float = SPIKE_THRESHOLD,
                    baseline_window: int   = BASELINE_WINDOW) -> pd.DataFrame:
    """
    Add alert_spike, alert_trend3, and alert_level columns.

    The input DataFrame must have:  area_id, month, risk_index.
    It should already be sorted by (area_id, month).

    Returns enriched DataFrame (operates on a copy).
    """
    df = df.copy().sort_values(["area_id", "month"]).reset_index(drop=True)

    spike_flags  = []
    trend3_flags = []

    for area_id, group in df.groupby("area_id", sort=False):
        ri = group["risk_index"]

        spike  = _spike_flag(ri, window=baseline_window, threshold=spike_threshold)
        trend3 = _trend3_flag(ri)

        # Fill NaN positions (insufficient history or no valid exposure) → False
        spike_flags.append(spike.fillna(False))
        trend3_flags.append(trend3.fillna(False))

    df["alert_spike"]  = pd.concat(spike_flags).reindex(df.index)
    df["alert_trend3"] = pd.concat(trend3_flags).reindex(df.index)

    # alert_level: combine both flags
    def _level(row) -> str:
        n = int(row["alert_spike"]) + int(row["alert_trend3"])
        if n == 0:
            return "none"
        if n == 1:
            return "watch"
        return "warning"

    df["alert_level"] = df.apply(_level, axis=1)

    return df


# ---------------------------------------------------------------------------
# Convenience entry point
# ---------------------------------------------------------------------------

def enrich_panel(df: pd.DataFrame,
                 spike_threshold: float = SPIKE_THRESHOLD,
                 baseline_window: int   = BASELINE_WINDOW) -> pd.DataFrame:
    """
    Full enrichment pipeline:
      1. add_risk_metrics  – computes risk_ratio, risk_index, stability_flag, …
      2. add_alert_flags   – computes alert_spike, alert_trend3, alert_level

    Parameters
    ----------
    df : pd.DataFrame
        Must contain: area_id, area_name, month, theft_count, exposure.
    spike_threshold : float
        Fractional increase above 6-month baseline that triggers spike alert.
        Default 0.5 (50 %).
    baseline_window : int
        Number of preceding months used as the baseline window.  Default 6.

    Returns
    -------
    pd.DataFrame  – sorted by (area_id, month), all derived columns added.
    """
    df = add_risk_metrics(df)
    df = add_alert_flags(df,
                         spike_threshold=spike_threshold,
                         baseline_window=baseline_window)
    return df


# ---------------------------------------------------------------------------
# Summary helper (used by build_dataset.py for logging)
# ---------------------------------------------------------------------------

def alert_summary(df: pd.DataFrame) -> str:
    """Return a short human-readable summary of alert counts."""
    total        = len(df)
    spike_count  = df["alert_spike"].sum()
    trend3_count = df["alert_trend3"].sum()
    warning_count = (df["alert_level"] == "warning").sum()
    watch_count   = (df["alert_level"] == "watch").sum()
    return (
        f"{total} rows | "
        f"alert_spike={spike_count} | alert_trend3={trend3_count} | "
        f"watch={watch_count} | warning={warning_count}"
    )
