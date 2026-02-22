/**
 * RankingChart  (D2)
 * ──────────────────────────────────────────────────────────────────────────
 * Chart.js horizontal bar chart showing the Top-N Boroughs ranked by the
 * active metric.
 *
 * Bar colours communicate two things simultaneously:
 *   • Alert status  – warning = red, watch = amber, (or selected = orange)
 *   • Metric value  – for non-alert non-selected bars, a risk-index colour
 *                     scale matching the map is used (green → red)
 *
 * Clicking a bar selects / deselects the corresponding Borough.
 *
 * Props
 * ─────
 *   rankedTopN     array  – pre-sorted rows from App.jsx (max 10)
 *   mode           'metricCompare' | 'monthCompare'
 *   displayMetric  'risk_index' | 'theft_count'   (metricCompare only)
 *   selectedAreaId string | null
 *   onSelectArea   (id: string | null) => void
 */

import { useMemo, useCallback, useRef } from 'react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  BarElement, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

// ── Colour helpers ────────────────────────────────────────────────────────────

/** Map a risk_index value to the same colour steps used on the choropleth. */
function riskColor(ri) {
  if (ri == null || isNaN(ri)) return 'rgba(71,85,105,0.55)'   // slate: no data
  if (ri >= 2.0)  return 'rgba(153,27,27,0.85)'
  if (ri >= 1.5)  return 'rgba(239,68,68,0.80)'
  if (ri >= 1.15) return 'rgba(249,115,22,0.80)'
  if (ri >= 0.85) return 'rgba(251,191,36,0.80)'
  if (ri >= 0.6)  return 'rgba(134,239,172,0.80)'
  return 'rgba(34,197,94,0.80)'
}

function barColor(f, metric, selectedAreaId) {
  if (f.area_id === selectedAreaId)     return 'rgba(249,115,22,0.95)'  // orange: selected
  if (f.alert_level === 'warning')      return 'rgba(239,68,68,0.80)'   // red
  if (f.alert_level === 'watch')        return 'rgba(251,191,36,0.80)'  // yellow
  // Non-alert: use metric-based colour for risk_index; flat slate for others
  return metric === 'risk_index' ? riskColor(f.risk_index) : 'rgba(100,116,139,0.60)'
}

function barBorderColor(f, selectedAreaId) {
  if (f.area_id === selectedAreaId) return 'rgba(249,115,22,1)'
  if (f.alert_level === 'warning')  return 'rgba(239,68,68,1)'
  if (f.alert_level === 'watch')    return 'rgba(251,191,36,1)'
  return 'transparent'
}

// ── Metric label / value accessor ─────────────────────────────────────────────

function metricLabel(mode, displayMetric) {
  if (mode === 'monthCompare') return 'Δ Risk Index'
  return displayMetric === 'risk_index' ? 'Risk Index' : 'Theft Count'
}

function metricValue(f, mode, displayMetric) {
  if (mode === 'monthCompare') return f.delta_risk_index ?? null
  return f[displayMetric] ?? null
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RankingChart({
  rankedTopN,
  mode,
  displayMetric,
  selectedAreaId,
  onSelectArea,
}) {
  const chartRef = useRef(null)

  const metric = mode === 'monthCompare' ? 'delta_risk_index' : displayMetric

  // ── Chart data ────────────────────────────────────────────────────────────
  const data = useMemo(() => ({
    labels: rankedTopN.map(f => f.area_name),
    datasets: [{
      data:            rankedTopN.map(f => metricValue(f, mode, displayMetric)),
      backgroundColor: rankedTopN.map(f => barColor(f, metric, selectedAreaId)),
      borderColor:     rankedTopN.map(f => barBorderColor(f, selectedAreaId)),
      borderWidth:     rankedTopN.map(f =>
        f.area_id === selectedAreaId || f.alert_level !== 'none' ? 1.5 : 0
      ),
      borderRadius:    3,
      borderSkipped:   false,
    }],
  }), [rankedTopN, mode, displayMetric, metric, selectedAreaId])

  // ── Chart options ─────────────────────────────────────────────────────────
  const handleClick = useCallback((event, elements) => {
    if (!elements.length) return
    const idx  = elements[0].index
    const item = rankedTopN[idx]
    if (item) onSelectArea(item.area_id === selectedAreaId ? null : item.area_id)
  }, [rankedTopN, selectedAreaId, onSelectArea])

  const options = useMemo(() => ({
    indexAxis:           'y',
    responsive:          true,
    maintainAspectRatio: false,
    animation:           { duration: 200 },
    onClick:             handleClick,
    onHover: (event, elements) => {
      event.native.target.style.cursor = elements.length ? 'pointer' : 'default'
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#0f172a',
        titleColor:      '#e2e8f0',
        bodyColor:       '#94a3b8',
        borderColor:     '#334155',
        borderWidth:     1,
        padding:         8,
        callbacks: {
          label: ctx => {
            const f   = rankedTopN[ctx.dataIndex]
            const val = ctx.raw
            const fmtVal = val != null
              ? (mode === 'monthCompare' && val > 0 ? '+' : '') + (+val).toFixed(3)
              : '—'
            const alert = f?.alert_level !== 'none' ? `  ⚠ ${f.alert_level}` : ''
            return `${fmtVal}${alert}`
          },
          title: ctx => rankedTopN[ctx[0]?.dataIndex]?.area_name ?? '',
        },
      },
    },
    scales: {
      x: {
        grid:   { color: '#1e293b' },
        ticks:  { color: '#64748b', font: { size: 9 } },
        border: { color: '#334155' },
      },
      y: {
        grid:   { display: false },
        ticks:  {
          color: '#94a3b8',
          font:  { size: 9 },
          // Truncate long names
          callback: (_, i) => {
            const name = rankedTopN[i]?.area_name ?? ''
            return name.length > 18 ? name.slice(0, 17) + '…' : name
          },
        },
        border: { color: '#334155' },
      },
    },
  }), [handleClick, rankedTopN, mode])

  // ── Legend for alert colours ───────────────────────────────────────────────
  const hasWarning = rankedTopN.some(f => f.alert_level === 'warning')
  const hasWatch   = rankedTopN.some(f => f.alert_level === 'watch')

  // Dynamic height: 30px per bar + padding
  const chartHeight = Math.max(140, rankedTopN.length * 26 + 24)

  return (
    <div className="px-4 py-3 border-t border-slate-700">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-[10px] text-slate-500 uppercase tracking-widest">
          Top {rankedTopN.length} · {metricLabel(mode, displayMetric)}
        </p>
        {(hasWarning || hasWatch) && (
          <div className="flex items-center gap-2">
            {hasWarning && (
              <span className="flex items-center gap-1 text-[9px] text-red-400">
                <span className="w-2 h-2 rounded-sm bg-red-500/80 inline-block" />
                Warning
              </span>
            )}
            {hasWatch && (
              <span className="flex items-center gap-1 text-[9px] text-yellow-400">
                <span className="w-2 h-2 rounded-sm bg-yellow-500/80 inline-block" />
                Watch
              </span>
            )}
          </div>
        )}
      </div>

      {/* Chart */}
      {rankedTopN.length === 0 ? (
        <p className="text-xs text-slate-600">No data</p>
      ) : (
        <div style={{ height: chartHeight }}>
          <Bar ref={chartRef} data={data} options={options} />
        </div>
      )}
    </div>
  )
}
