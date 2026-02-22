/**
 * DualMapPanel  (C5 + D1 + D3)
 * ──────────────────────────────────────────────────────────────────────────
 * Two MapLibre GL maps, side-by-side, fully synced.
 *
 * metricCompare mode
 *   Left  – Theft Count   (currentFeatures)
 *   Right – Risk Index    (currentFeatures)
 *
 * monthCompare mode, showDelta = false   [A | B]
 *   Left  – Risk Index, Month A   (featuresA)
 *   Right – Risk Index, Month B   (featuresB)
 *
 * monthCompare mode, showDelta = true    [Δ]
 *   Left  – Risk Index, Month A   (featuresA)  ← anchor / reference
 *   Right – Δ Risk Index (B − A)  (deltaFeatures)
 *
 * D3: every Borough with alert_level 'warning' gets a red border;
 *     'watch' gets a yellow border.  The selected Borough always gets
 *     an orange border at the highest priority.
 */

import { useState, useMemo, useCallback } from 'react'
import { Map, Source, Layer } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'

// ── MapLibre paint expressions ───────────────────────────────────────────────

const THEFT_COUNT_COLOR = [
  'step', ['coalesce', ['get', 'theft_count'], -1], '#475569',
  0,   '#e2e8f0',  1,   '#22c55e',  20,  '#86efac',
  40,  '#fbbf24',  65,  '#f97316',  90,  '#ef4444',  120, '#991b1b',
]

const RISK_INDEX_COLOR = [
  'step', ['coalesce', ['get', 'risk_index'], -1], '#475569',
  0.0, '#22c55e',  0.6, '#86efac',  0.85, '#fbbf24',
  1.15,'#f97316',  1.5, '#ef4444',  2.0,  '#991b1b',
]

const DELTA_RISK_COLOR = [
  'interpolate', ['linear'],
  ['coalesce', ['get', 'delta_risk_index'], 0],
  -1.5, '#22c55e',  -0.4, '#86efac',
   0.0, '#94a3b8',
   0.4, '#fbbf24',   0.8, '#f97316',  1.5, '#991b1b',
]

// ── Legend definitions ───────────────────────────────────────────────────────

const COUNT_LEGEND = {
  title: 'Theft Count',
  items: [
    { color: '#e2e8f0', label: '0' },         { color: '#22c55e', label: '1–19' },
    { color: '#86efac', label: '20–39' },      { color: '#fbbf24', label: '40–64' },
    { color: '#f97316', label: '65–89' },      { color: '#ef4444', label: '90–119' },
    { color: '#991b1b', label: '≥ 120' },
  ],
}

const RISK_LEGEND = {
  title: 'Risk Index',
  subtitle: 'baseline = 1.0',
  items: [
    { color: '#22c55e', label: '< 0.6' },      { color: '#86efac', label: '0.6–0.85' },
    { color: '#fbbf24', label: '0.85–1.15' },  { color: '#f97316', label: '1.15–1.5' },
    { color: '#ef4444', label: '1.5–2.0' },    { color: '#991b1b', label: '> 2.0' },
    { color: '#475569', label: 'No data' },
  ],
}

const DELTA_LEGEND = {
  title: 'Δ Risk Index (B − A)',
  subtitle: 'change vs month A',
  items: [
    { color: '#22c55e', label: '< −1.0  big drop' },
    { color: '#86efac', label: '−1.0 to −0.4  drop' },
    { color: '#94a3b8', label: '≈ 0  stable' },
    { color: '#fbbf24', label: '0.4–0.8  rise' },
    { color: '#f97316', label: '0.8–1.5  large rise' },
    { color: '#991b1b', label: '> 1.5  big rise' },
  ],
}

// alert border legends (appended at bottom of main legend)
const ALERT_LEGEND_ITEMS = [
  { color: '#ef4444', label: '── Warning alert' },
  { color: '#fbbf24', label: '── Watch alert' },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtMonth(ym) {
  if (!ym) return '—'
  const [y, m] = ym.split('-')
  return new Date(+y, +m - 1, 1).toLocaleString('en-GB', { month: 'short', year: 'numeric' })
}

// ── Legend overlay ────────────────────────────────────────────────────────────

function Legend({ def, showAlerts }) {
  return (
    <div className="absolute bottom-5 left-3 bg-slate-900/90 backdrop-blur-sm rounded-lg p-2.5 text-[10px] border border-slate-700 min-w-[150px] pointer-events-none">
      <p className="font-semibold text-slate-200 mb-0.5">{def.title}</p>
      {def.subtitle && <p className="text-slate-500 mb-1.5">{def.subtitle}</p>}
      <div className="space-y-1">
        {def.items.map(it => (
          <div key={it.label} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: it.color }} />
            <span className="text-slate-300">{it.label}</span>
          </div>
        ))}
        {showAlerts && (
          <>
            <div className="border-t border-slate-700 mt-1.5 pt-1.5">
              <p className="text-slate-500 mb-1">Alert borders:</p>
              {ALERT_LEGEND_ITEMS.map(it => (
                <div key={it.label} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-0.5 shrink-0 rounded" style={{ backgroundColor: it.color }} />
                  <span className="text-slate-300">{it.label}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Map header label ──────────────────────────────────────────────────────────

function MapLabel({ title, month, accentClass }) {
  return (
    <div className="absolute top-3 left-3 z-10 bg-slate-900/80 backdrop-blur-sm rounded px-2.5 py-1 text-[11px] border border-slate-700 pointer-events-none">
      <span className={`font-semibold ${accentClass}`}>{title}</span>
      {month && <span className="text-slate-400 ml-1">· {fmtMonth(month)}</span>}
    </div>
  )
}

// ── Single map wrapper ────────────────────────────────────────────────────────

function OneMap({
  id, geoJSON, fillColor, selectedAreaId,
  filterAlertsOnly, filterStableOnly,
  viewState, onMove, onClick, getCursor,
  label, month, accentClass, legend, hasAlerts,
}) {
  // ── D4: fill opacity responds to filter toggles ──────────────────────────
  // Priority: selected > alert (preserved) > filters (dim) > default
  const fillOpacity = useMemo(() => [
    'case',
    // 1. Selected area: always fully visible
    ['==', ['get', 'area_id'], selectedAreaId ?? ''], 0.92,
    // 2. When "Alerts only": non-alert areas become ghost
    ...(filterAlertsOnly
      ? [['!', ['in', ['get', 'alert_level'], ['literal', ['warning', 'watch']]]], 0.06]
      : []),
    // 3. When "Hide unstable": low-exposure areas become ghost
    ...(filterStableOnly
      ? [['==', ['get', 'stability_flag'], true], 0.06]
      : []),
    // 4. Default
    0.72,
  ], [selectedAreaId, filterAlertsOnly, filterStableOnly])

  // ── D3 + D4: border — selection > alert borders > filter dimming ─────────
  const borderPaint = useMemo(() => ({
    'line-color': ['case',
      ['==', ['get', 'area_id'], selectedAreaId ?? ''], '#f97316',
      ['==', ['get', 'alert_level'], 'warning'],        '#ef4444',
      ['==', ['get', 'alert_level'], 'watch'],          '#fbbf24',
      '#0f172a',
    ],
    'line-width': ['case',
      ['==', ['get', 'area_id'], selectedAreaId ?? ''], 2.5,
      ['==', ['get', 'alert_level'], 'warning'],        2.0,
      ['==', ['get', 'alert_level'], 'watch'],          1.5,
      0.5,
    ],
    // When a filter is active, non-matching border opacity → 0 (invisible)
    'line-opacity': ['case',
      ['==', ['get', 'area_id'], selectedAreaId ?? ''], 1.0,
      ['in', ['get', 'alert_level'], ['literal', ['warning', 'watch']]], 0.85,
      ...(filterStableOnly
        ? [['==', ['get', 'stability_flag'], true], 0.0]
        : []),
      // Non-alert fallback: hide when filterAlertsOnly, faint otherwise
      filterAlertsOnly ? 0.0 : 0.35,
    ],
  }), [selectedAreaId, filterAlertsOnly, filterStableOnly])

  return (
    <div className="flex-1 relative overflow-hidden">
      <MapLabel title={label} month={month} accentClass={accentClass} />
      <Map
        id={id}
        {...viewState}
        onMove={onMove}
        style={{ width: '100%', height: '100%' }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        interactiveLayerIds={['borough-fill']}
        onClick={onClick}
        getCursor={getCursor}
      >
        <Source id="boroughs" type="geojson" data={geoJSON}>
          <Layer
            id="borough-fill"
            type="fill"
            paint={{ 'fill-color': fillColor, 'fill-opacity': fillOpacity }}
          />
          {/* D3: alert + selection borders */}
          <Layer id="alert-borders" type="line" paint={borderPaint} />
        </Source>
      </Map>
      <Legend def={legend} showAlerts={hasAlerts} />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const INITIAL_VIEW = { longitude: -0.118, latitude: 51.507, zoom: 9.2 }

export default function DualMapPanel({
  areas,
  currentFeatures,   // metricCompare: current month
  featuresA,         // monthCompare: month A rows
  featuresB,         // monthCompare: month B rows
  deltaFeatures,     // monthCompare: pre-computed Δ rows
  selectedAreaId,
  onSelectArea,
  currentMonth,
  monthA,
  monthB,
  mode,              // 'metricCompare' | 'monthCompare'
  showDelta,         // monthCompare only: false=[A|B]  true=[Δ right panel]
  filterAlertsOnly,  // D4: dim non-alert areas on map
  filterStableOnly,  // D4: dim low-exposure areas on map
}) {
  const [viewState, setViewState] = useState(INITIAL_VIEW)

  // ── Build enriched GeoJSON from a feature-row array ───────────────────────
  const makeGeoJSON = useCallback((rows) => {
    if (!areas) return null
    if (!rows?.length) return areas
    const dataByArea = Object.fromEntries(rows.map(f => [f.area_id, f]))
    return {
      type: 'FeatureCollection',
      features: areas.features.map(f => ({
        ...f,
        properties: { ...f.properties, ...(dataByArea[f.properties.area_id] ?? {}) },
      })),
    }
  }, [areas])

  // GeoJSON for each panel
  const leftGeoJSON = useMemo(() => {
    const rows = mode === 'metricCompare' ? currentFeatures : featuresA
    return makeGeoJSON(rows)
  }, [makeGeoJSON, mode, currentFeatures, featuresA])

  const rightGeoJSON = useMemo(() => {
    if (mode === 'metricCompare') return makeGeoJSON(currentFeatures)
    if (showDelta)                return makeGeoJSON(deltaFeatures)
    return makeGeoJSON(featuresB)
  }, [makeGeoJSON, mode, showDelta, currentFeatures, featuresB, deltaFeatures])

  // ── Event handlers ────────────────────────────────────────────────────────
  const handleMove  = useCallback(evt => setViewState(evt.viewState), [])
  const handleClick = useCallback(evt => {
    const clickedId = evt.features?.[0]?.properties?.area_id ?? null
    onSelectArea(clickedId === selectedAreaId ? null : clickedId)
  }, [selectedAreaId, onSelectArea])
  const getCursor = useCallback(
    ({ isHovering, isDragging }) => isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab',
    []
  )

  if (!leftGeoJSON || !rightGeoJSON) return null

  // ── Label / colour / legend config per mode ───────────────────────────────
  let leftLabel, rightLabel, leftMonth, rightMonth
  let leftFill, rightFill, leftLegend, rightLegend

  if (mode === 'metricCompare') {
    leftLabel  = 'Theft Count';  rightLabel  = 'Risk Index'
    leftMonth  = currentMonth;   rightMonth  = currentMonth
    leftFill   = THEFT_COUNT_COLOR
    rightFill  = RISK_INDEX_COLOR
    leftLegend = COUNT_LEGEND;   rightLegend = RISK_LEGEND
  } else if (showDelta) {
    leftLabel  = 'Risk Index A';  rightLabel  = 'Δ Risk Index'
    leftMonth  = monthA;          rightMonth  = null
    leftFill   = RISK_INDEX_COLOR
    rightFill  = DELTA_RISK_COLOR
    leftLegend = RISK_LEGEND;    rightLegend = DELTA_LEGEND
  } else {
    leftLabel  = 'Risk Index A';  rightLabel  = 'Risk Index B'
    leftMonth  = monthA;          rightMonth  = monthB
    leftFill   = RISK_INDEX_COLOR
    rightFill  = RISK_INDEX_COLOR
    leftLegend = RISK_LEGEND;    rightLegend = RISK_LEGEND
  }

  // Check if any alerts exist to decide whether to show alert legend items
  const hasAlerts = [...(featuresA ?? []), ...(currentFeatures ?? [])]
    .some(f => f.alert_level && f.alert_level !== 'none')

  const common = {
    viewState, onMove: handleMove, onClick: handleClick, getCursor,
    selectedAreaId, hasAlerts,
    filterAlertsOnly: !!filterAlertsOnly,
    filterStableOnly: !!filterStableOnly,
  }

  return (
    <div className="flex h-full">
      <OneMap
        id="map-left"
        geoJSON={leftGeoJSON}
        fillColor={leftFill}
        label={leftLabel}
        month={leftMonth}
        accentClass="text-sky-400"
        legend={leftLegend}
        {...common}
      />
      <div className="w-px bg-slate-700 flex-shrink-0" />
      <OneMap
        id="map-right"
        geoJSON={rightGeoJSON}
        fillColor={rightFill}
        label={rightLabel}
        month={rightMonth}
        accentClass={showDelta && mode === 'monthCompare' ? 'text-purple-400' : 'text-orange-400'}
        legend={rightLegend}
        {...common}
      />
    </div>
  )
}
