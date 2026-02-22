/**
 * BikeMap (C4 – single choropleth map)
 *
 * Renders a MapLibre GL choropleth of London Boroughs coloured by the
 * active metric.  Click a Borough to select it; click again (or click
 * empty space) to deselect.
 *
 * Props
 * ─────
 * areas           GeoJSON FeatureCollection  – Borough boundaries
 * currentFeatures array  – month × borough rows for the current month
 * deltaFeatures   array  – delta rows for monthCompare mode
 * mode            'metricCompare' | 'monthCompare'
 * displayMetric   'risk_index' | 'theft_count'  (metricCompare only)
 * selectedAreaId  string | null
 * onSelectArea    (id: string | null) => void
 * currentMonth    string  'YYYY-MM'
 * monthA / monthB string  'YYYY-MM'  (monthCompare)
 */

import { useMemo, useCallback } from 'react'
import { Map, Source, Layer } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'

// ── MapLibre paint expression factories ─────────────────────────────────────

/**
 * Stepped fill-color for risk_index (baseline = 1.0)
 * coalesce handles null values → shows neutral slate.
 */
const RISK_INDEX_COLOR = [
  'step',
  ['coalesce', ['get', 'risk_index'], -1],
  '#475569',        // null / invalid  → slate-600
  0.0, '#22c55e',   // 0.0 – 0.6      → green
  0.6, '#86efac',   // 0.6 – 0.85     → light green
  0.85,'#fbbf24',   // 0.85 – 1.15    → amber (≈ average)
  1.15,'#f97316',   // 1.15 – 1.5     → orange
  1.5, '#ef4444',   // 1.5 – 2.0      → red
  2.0, '#991b1b',   // > 2.0          → dark red
]

/**
 * Stepped fill-color for theft_count (absolute monthly incidents)
 */
const THEFT_COUNT_COLOR = [
  'step',
  ['coalesce', ['get', 'theft_count'], -1],
  '#475569',        // null
  0,  '#e2e8f0',   // 0           → near-white (no theft)
  1,  '#22c55e',   // 1 – 19      → green
  20, '#86efac',   // 20 – 39     → light green
  40, '#fbbf24',   // 40 – 64     → amber
  65, '#f97316',   // 65 – 89     → orange
  90, '#ef4444',   // 90 – 119    → red
  120,'#991b1b',   // ≥ 120       → dark red
]

/**
 * Interpolated diverging fill-color for delta_risk_index
 * Negative = improvement (green), zero = neutral, positive = deterioration (red)
 */
const DELTA_RISK_COLOR = [
  'interpolate',
  ['linear'],
  ['coalesce', ['get', 'delta_risk_index'], 0],
  -1.5, '#22c55e',
  -0.4, '#86efac',
   0.0, '#94a3b8',   // neutral slate
   0.4, '#fbbf24',
   0.8, '#f97316',
   1.5, '#991b1b',
]

// ── Legend data ──────────────────────────────────────────────────────────────

const LEGENDS = {
  risk_index: {
    title: 'Risk Index',
    subtitle: 'Borough ÷ city mean (1.0 = average)',
    items: [
      { color: '#22c55e', label: '< 0.6 — low'      },
      { color: '#86efac', label: '0.6–0.85 — below avg' },
      { color: '#fbbf24', label: '0.85–1.15 — average' },
      { color: '#f97316', label: '1.15–1.5 — above avg' },
      { color: '#ef4444', label: '1.5–2.0 — high'    },
      { color: '#991b1b', label: '> 2.0 — very high' },
      { color: '#475569', label: 'No exposure data'  },
    ],
  },
  theft_count: {
    title: 'Monthly Theft Count',
    subtitle: 'Bicycle theft incidents',
    items: [
      { color: '#e2e8f0', label: '0 — no incidents'  },
      { color: '#22c55e', label: '1–19'              },
      { color: '#86efac', label: '20–39'             },
      { color: '#fbbf24', label: '40–64'             },
      { color: '#f97316', label: '65–89'             },
      { color: '#ef4444', label: '90–119'            },
      { color: '#991b1b', label: '≥ 120'             },
    ],
  },
  delta_risk_index: {
    title: 'Δ Risk Index (B − A)',
    subtitle: 'Change in relative risk',
    items: [
      { color: '#22c55e', label: '< −1.0 — big drop'   },
      { color: '#86efac', label: '−1.0 to −0.3 — drop' },
      { color: '#94a3b8', label: '≈ 0 — stable'        },
      { color: '#fbbf24', label: '0.3–0.8 — rise'      },
      { color: '#f97316', label: '0.8–1.5 — large rise' },
      { color: '#991b1b', label: '> 1.5 — big rise'    },
    ],
  },
}

// ── Helper ───────────────────────────────────────────────────────────────────

function fmtMonth(ym) {
  if (!ym) return '—'
  const [y, m] = ym.split('-')
  return new Date(+y, +m - 1, 1).toLocaleString('en-GB', { month: 'short', year: 'numeric' })
}

// ── Sub-components ───────────────────────────────────────────────────────────

function MapLegend({ mode, displayMetric }) {
  const key    = mode === 'monthCompare' ? 'delta_risk_index' : displayMetric
  const legend = LEGENDS[key]
  if (!legend) return null

  return (
    <div className="absolute bottom-6 left-4 bg-slate-900/90 backdrop-blur-sm rounded-lg p-3 text-xs shadow-xl border border-slate-700 min-w-[170px]">
      <p className="font-semibold text-slate-200 mb-0.5">{legend.title}</p>
      <p className="text-slate-500 mb-2 text-[10px]">{legend.subtitle}</p>
      <div className="space-y-1">
        {legend.items.map(item => (
          <div key={item.label} className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-sm shrink-0"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-slate-300">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Area detail view is handled by ExplainCard in the right panel (C6).

// ── Main component ───────────────────────────────────────────────────────────

export default function BikeMap({
  areas,
  currentFeatures,
  deltaFeatures,
  mode,
  displayMetric,
  selectedAreaId,
  onSelectArea,
  currentMonth,
  monthA,
  monthB,
}) {
  // ── Build enriched GeoJSON by merging feature data into area properties ──
  const enrichedGeoJSON = useMemo(() => {
    if (!areas) return null

    const activeRows = mode === 'monthCompare' ? deltaFeatures : currentFeatures
    const dataByArea = Object.fromEntries(activeRows.map(f => [f.area_id, f]))

    return {
      type: 'FeatureCollection',
      features: areas.features.map(f => ({
        ...f,
        properties: {
          ...f.properties,
          ...(dataByArea[f.properties.area_id] ?? {}),
        },
      })),
    }
  }, [areas, currentFeatures, deltaFeatures, mode])

  // ── Fill colour expression (switches by mode + displayMetric) ────────────
  const fillColor = useMemo(() => {
    if (mode === 'monthCompare') return DELTA_RISK_COLOR
    return displayMetric === 'theft_count' ? THEFT_COUNT_COLOR : RISK_INDEX_COLOR
  }, [mode, displayMetric])

  // ── Fill opacity: boost selected area ────────────────────────────────────
  const fillOpacity = useMemo(() => [
    'case',
    ['==', ['get', 'area_id'], selectedAreaId ?? ''],
    0.92,
    0.72,
  ], [selectedAreaId])

  // ── D3: unified alert + selection border ──────────────────────────────────
  // selected (orange) > warning (red) > watch (yellow) > base (dark thin)
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
    'line-opacity': ['case',
      ['==', ['get', 'area_id'], selectedAreaId ?? ''], 1.0,
      ['in', ['get', 'alert_level'], ['literal', ['warning', 'watch']]], 0.85,
      0.4,
    ],
  }), [selectedAreaId])

  // ── Click handler ─────────────────────────────────────────────────────────
  const handleClick = useCallback((event) => {
    const feature = event.features?.[0]
    const clickedId = feature?.properties?.area_id ?? null
    onSelectArea(clickedId === selectedAreaId ? null : clickedId)
  }, [selectedAreaId, onSelectArea])

  // ── Cursor: pointer when hovering an interactive area ─────────────────
  const getCursor = useCallback(
    ({ isHovering, isDragging }) =>
      isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab',
    []
  )


  if (!enrichedGeoJSON) return null

  return (
    <div className="w-full h-full relative">
      <Map
        initialViewState={{
          longitude: -0.118,
          latitude: 51.507,
          zoom: 9.5,
        }}
        style={{ width: '100%', height: '100%' }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        interactiveLayerIds={['borough-fill']}
        onClick={handleClick}
        getCursor={getCursor}
      >
        <Source id="boroughs" type="geojson" data={enrichedGeoJSON}>
          {/* Fill layer */}
          <Layer
            id="borough-fill"
            type="fill"
            paint={{
              'fill-color':   fillColor,
              'fill-opacity': fillOpacity,
            }}
          />
          {/* D3: alert + selection borders */}
          <Layer id="alert-borders" type="line" paint={borderPaint} />
        </Source>
      </Map>

      {/* ── Map title badge ── */}
      <div className="absolute top-4 left-4 bg-slate-900/80 backdrop-blur-sm rounded px-3 py-1.5 text-xs border border-slate-700">
        {mode === 'metricCompare' ? (
          <span className="text-slate-300">
            <span className="text-orange-400 font-medium">
              {displayMetric === 'risk_index' ? 'Risk Index' : 'Theft Count'}
            </span>
            {' · '}{fmtMonth(currentMonth)}
          </span>
        ) : (
          <span className="text-slate-300">
            <span className="text-sky-400 font-medium">{fmtMonth(monthA)}</span>
            {' → '}
            <span className="text-orange-400 font-medium">{fmtMonth(monthB)}</span>
            {' · Δ Risk Index'}
          </span>
        )}
      </div>

      {/* ── Legend ── */}
      <MapLegend mode={mode} displayMetric={displayMetric} />
    </div>
  )
}
