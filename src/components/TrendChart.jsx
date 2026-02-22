/**
 * TrendChart  (C7)
 * ──────────────────────────────────────────────────────────────────────────
 * Chart.js line chart showing risk_index over all available months for the
 * selected Borough, with:
 *   • City baseline dashed line at y = 1.0
 *   • Alert months highlighted with red dots
 *   • A vertical marker line at currentMonthIndex (blue dashed)
 *
 * Uses a custom inline Chart.js plugin for the vertical marker so no extra
 * dependency is required.
 */

import { useMemo, useRef } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Line } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale, LinearScale,
  PointElement, LineElement,
  Title, Tooltip, Legend, Filler,
)

// ── Custom plugin: vertical line at currentMonth ─────────────────────────────

const verticalLinePlugin = {
  id: 'verticalLine',
  afterDraw(chart) {
    const { xValue } = chart.options.plugins?.verticalLine ?? {}
    if (xValue == null) return

    const { ctx, chartArea, scales } = chart
    const x = scales.x.getPixelForValue(xValue)

    ctx.save()
    ctx.beginPath()
    ctx.strokeStyle = '#60a5fa'   // blue-400
    ctx.lineWidth   = 1.5
    ctx.setLineDash([5, 4])
    ctx.globalAlpha = 0.85
    ctx.moveTo(x, chartArea.top)
    ctx.lineTo(x, chartArea.bottom)
    ctx.stroke()
    ctx.restore()
  },
}

ChartJS.register(verticalLinePlugin)

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtMonthShort(ym) {
  if (!ym) return ''
  const [y, m] = ym.split('-')
  return new Date(+y, +m - 1, 1).toLocaleString('en-GB', { month: 'short' })
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TrendChart({
  features,
  selectedAreaId,
  meta,
  currentMonthIndex,
}) {
  const chartRef = useRef(null)

  // ── Build per-month series for this area ──────────────────────────────────
  const series = useMemo(() => {
    if (!features || !selectedAreaId || !meta?.months) return []
    return meta.months.map(month => {
      const row = features.find(f => f.area_id === selectedAreaId && f.month === month)
      return {
        month,
        risk_index:   row?.risk_index ?? null,
        alert_spike:  row?.alert_spike  ?? false,
        alert_trend3: row?.alert_trend3 ?? false,
        theft_count:  row?.theft_count  ?? null,
        area_name:    row?.area_name    ?? '',
      }
    })
  }, [features, selectedAreaId, meta])

  const areaName = series.find(s => s.area_name)?.area_name ?? selectedAreaId

  // ── Chart dataset ─────────────────────────────────────────────────────────
  const data = useMemo(() => {
    const labels    = meta?.months.map(fmtMonthShort) ?? []
    const riValues  = series.map(s => s.risk_index)

    // Point styling: red/larger for alert months
    const pointColors = series.map(s =>
      s.alert_spike || s.alert_trend3 ? '#ef4444' : '#f97316'
    )
    const pointRadii = series.map(s =>
      s.alert_spike || s.alert_trend3 ? 6 : 3
    )
    const pointBorders = series.map(s =>
      s.alert_spike || s.alert_trend3 ? '#fca5a5' : '#f97316'
    )

    return {
      labels,
      datasets: [
        {
          label: areaName,
          data: riValues,
          borderColor:           '#f97316',
          backgroundColor:       'rgba(249,115,22,0.08)',
          pointBackgroundColor:  pointColors,
          pointBorderColor:      pointBorders,
          pointRadius:           pointRadii,
          pointHoverRadius:      7,
          tension:               0.35,
          fill:                  true,
          spanGaps:              true,
        },
        {
          label: 'City baseline',
          data: labels.map(() => 1.0),
          borderColor:     '#64748b',
          borderDash:      [5, 4],
          borderWidth:     1.5,
          pointRadius:     0,
          pointHoverRadius:0,
          fill:            false,
          tension:         0,
        },
      ],
    }
  }, [series, areaName, meta])

  // ── Chart options ─────────────────────────────────────────────────────────
  const options = useMemo(() => ({
    responsive:          true,
    maintainAspectRatio: false,
    animation:           { duration: 250 },
    interaction: {
      mode:         'index',
      intersect:    false,
    },
    scales: {
      x: {
        grid:   { color: '#1e293b' },
        ticks:  {
          color: '#64748b',
          font:  { size: 9 },
          maxRotation: 0,
          // Show every other label to avoid crowding
          callback: (_, i) => i % 2 === 0 ? data.labels[i] : '',
        },
      },
      y: {
        min:   0,
        grid:  { color: '#1e293b' },
        ticks: { color: '#64748b', font: { size: 9 } },
        title: {
          display: true,
          text:    'Risk Index',
          color:   '#475569',
          font:    { size: 9 },
        },
      },
    },
    plugins: {
      legend: {
        display:  true,
        position: 'top',
        labels:   {
          color:    '#94a3b8',
          boxWidth: 12,
          font:     { size: 9 },
          padding:  8,
          usePointStyle: true,
        },
      },
      tooltip: {
        backgroundColor: '#0f172a',
        titleColor:      '#e2e8f0',
        bodyColor:       '#94a3b8',
        borderColor:     '#334155',
        borderWidth:     1,
        padding:         8,
        callbacks: {
          label: ctx => {
            if (ctx.datasetIndex === 0) {
              const s = series[ctx.dataIndex]
              const alerts = [
                s?.alert_spike  ? 'Spike'       : '',
                s?.alert_trend3 ? '3mo rising'  : '',
              ].filter(Boolean).join(', ')
              const val = ctx.raw?.toFixed(3) ?? '—'
              return alerts ? `${val}  ⚠ ${alerts}` : val
            }
            return ctx.raw?.toFixed(1) ?? '—'
          },
          title: ctx => {
            const i   = ctx[0]?.dataIndex
            const s   = series[i]
            return s ? `${s.month}  (thefts: ${s.theft_count ?? '—'})` : ''
          },
        },
      },
      // Custom plugin options
      verticalLine: {
        xValue: currentMonthIndex,
      },
    },
  }), [data.labels, currentMonthIndex, series])

  if (!series.length) return null

  return (
    <div className="border-b border-slate-700 px-4 py-3">
      <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">
        Risk Index over time
      </p>
      <p className="text-[10px] text-slate-500 mb-2">
        <span className="inline-block w-2 h-0.5 bg-blue-400 opacity-70 mr-1 align-middle" />
        Blue line = currently selected month
        {'  '}
        <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1 align-middle" />
        Red dot = alert
      </p>
      <div className="h-44">
        <Line ref={chartRef} data={data} options={options} />
      </div>
    </div>
  )
}
