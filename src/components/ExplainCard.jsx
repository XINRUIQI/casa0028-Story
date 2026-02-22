/**
 * ExplainCard  (C6)
 * ──────────────────────────────────────────────────────────────────────────
 * Detailed analysis panel shown in the right sidebar when a Borough is selected.
 *
 * metricCompare mode  →  shows current-month snapshot:
 *   theft_count, exposure, risk_ratio, risk_index
 *   stability_flag warning
 *   alert_spike / alert_trend3 explanation (with computed context)
 *
 * monthCompare mode   →  shows delta view:
 *   Month A and Month B values side-by-side
 *   Δ risk_index and Δ theft_count
 *   Alert flags from Month B
 *
 * Props
 * ─────
 *   selectedAreaId   string
 *   features         all rows (for alert context computation)
 *   currentFeatures  rows for the current month
 *   deltaFeatures    pre-computed delta rows
 *   meta             { months, ... }
 *   mode             'metricCompare' | 'monthCompare'
 *   currentMonth     'YYYY-MM'
 *   monthA / monthB  'YYYY-MM'
 *   onClose          () => void
 */

import { useMemo } from 'react'

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtMonth(ym) {
  if (!ym) return '—'
  const [y, m] = ym.split('-')
  return new Date(+y, +m - 1, 1).toLocaleString('en-GB', { month: 'short', year: 'numeric' })
}

function round(v, d = 3) {
  return v != null ? (+v).toFixed(d) : '—'
}

function sign(v) {
  return v > 0 ? '+' : ''
}

// ── sub-components ───────────────────────────────────────────────────────────

function Row({ label, value, accent }) {
  return (
    <div className="flex justify-between items-baseline gap-2 py-0.5">
      <span className="text-slate-400 shrink-0">{label}</span>
      <span className={`font-mono font-medium text-right ${accent ?? 'text-slate-100'}`}>
        {value ?? '—'}
      </span>
    </div>
  )
}

function Divider() {
  return <div className="border-t border-slate-700/60 my-2" />
}

function AlertBadge({ level, spike, trend3 }) {
  if (level === 'none' || !level) return null
  const isWarning = level === 'warning'
  return (
    <div className={`flex flex-wrap items-center gap-1.5 mt-2 px-2 py-1.5 rounded text-[10px] font-medium border ${
      isWarning
        ? 'bg-red-500/10 border-red-500/30 text-red-300'
        : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300'
    }`}>
      <span>{isWarning ? '⚠ Warning' : '● Watch'}</span>
      {spike  && <span className="opacity-80">· risk spike detected</span>}
      {trend3 && <span className="opacity-80">· 3-month rise</span>}
    </div>
  )
}

// ── Metric-compare panel ──────────────────────────────────────────────────────

function MetricPanel({ data, spikeContext, alertThreshold }) {
  const ri = data.risk_index

  const riskAccent =
    ri > 1.5  ? 'text-red-400' :
    ri > 1.15 ? 'text-orange-300' :
    ri < 0.6  ? 'text-green-400' : 'text-slate-100'

  return (
    <>
      <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">
        Current snapshot
      </p>

      <Row label="Theft count"  value={data.theft_count} />
      <Row label="Exposure"     value={data.exposure}
           accent={data.stability_flag ? 'text-yellow-300' : undefined} />
      <Row label="Risk ratio"   value={round(data.risk_ratio, 4)} />
      <Row label="City mean"    value={round(data.city_mean_ratio, 4)} />
      <Divider />
      <Row label="Risk Index"   value={round(ri)} accent={riskAccent} />

      {/* stability warning */}
      {data.stability_flag && (
        <p className="text-[10px] text-yellow-400 leading-snug mt-1.5">
          ⚠ Low exposure ({data.exposure} spots) — ratio may be unreliable.
        </p>
      )}

      {/* alert badge */}
      <AlertBadge
        level={data.alert_level}
        spike={data.alert_spike}
        trend3={data.alert_trend3}
      />

      {/* alert explanation */}
      {data.alert_spike && spikeContext && (
        <div className="mt-2 bg-slate-700/40 rounded p-2 text-[10px] text-slate-300 leading-snug">
          <span className="text-orange-300 font-semibold">Spike: </span>
          Risk Index <span className="font-mono">{round(ri)}</span> exceeds
          6-month mean <span className="font-mono">{round(spikeContext.baseline)}</span> by{' '}
          <span className="font-mono text-orange-300">
            +{Math.round((ri / spikeContext.baseline - 1) * 100)}%
          </span>
          {' '}(threshold {Math.round((alertThreshold ?? 0.5) * 100)}%).
        </div>
      )}
      {data.alert_trend3 && (
        <div className="mt-2 bg-slate-700/40 rounded p-2 text-[10px] text-slate-300 leading-snug">
          <span className="text-yellow-300 font-semibold">Rising trend: </span>
          Risk Index has risen for 3 consecutive months.
        </div>
      )}
    </>
  )
}

// ── Month-compare panel ───────────────────────────────────────────────────────

function DeltaPanel({ data, monthA, monthB }) {
  const delta = data.delta_risk_index
  const deltaAccent =
    delta > 0.3  ? 'text-orange-300' :
    delta < -0.3 ? 'text-green-400'  : 'text-slate-100'

  return (
    <>
      <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">
        {fmtMonth(monthA)} → {fmtMonth(monthB)}
      </p>

      {/* Side-by-side months */}
      <div className="grid grid-cols-3 gap-x-2 text-[10px] text-slate-400 mb-1">
        <span />
        <span className="text-sky-400 font-medium text-center">A</span>
        <span className="text-orange-400 font-medium text-center">B</span>
      </div>
      <div className="grid grid-cols-3 gap-x-2 text-[10px] mb-1">
        <span className="text-slate-400">Risk Index</span>
        <span className="font-mono text-slate-200 text-center">{round(data.risk_index_a)}</span>
        <span className="font-mono text-slate-200 text-center">{round(data.risk_index_b)}</span>
      </div>
      <div className="grid grid-cols-3 gap-x-2 text-[10px] mb-1">
        <span className="text-slate-400">Thefts</span>
        <span className="font-mono text-slate-200 text-center">{data.theft_count_a ?? '—'}</span>
        <span className="font-mono text-slate-200 text-center">{data.theft_count_b ?? '—'}</span>
      </div>

      <Divider />

      <Row
        label="Δ Risk Index"
        value={delta != null ? sign(delta) + round(delta) : '—'}
        accent={deltaAccent}
      />
      <Row
        label="Δ Theft Count"
        value={data.delta_count != null ? sign(data.delta_count) + data.delta_count : '—'}
        accent={data.delta_count > 0 ? 'text-orange-300' : data.delta_count < 0 ? 'text-green-400' : undefined}
      />

      {/* Direction summary */}
      {delta != null && (
        <p className="text-[10px] text-slate-400 mt-2 leading-snug">
          {delta > 0.3
            ? `Risk increased significantly. This borough became relatively more dangerous than the city average.`
            : delta < -0.3
              ? `Risk decreased significantly. Relative risk improved vs. the city average.`
              : `Risk remained broadly stable between the two months.`}
        </p>
      )}

      <AlertBadge
        level={data.alert_level}
        spike={false}
        trend3={false}
      />
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ExplainCard({
  selectedAreaId,
  features,
  currentFeatures,
  deltaFeatures,
  meta,
  mode,
  currentMonth,
  monthA,
  monthB,
  alertThreshold,
  onClose,
}) {
  // ── Find the row for this area ──────────────────────────────────────────
  const currentData = useMemo(
    () => currentFeatures.find(f => f.area_id === selectedAreaId) ?? null,
    [currentFeatures, selectedAreaId]
  )

  const deltaData = useMemo(
    () => deltaFeatures.find(f => f.area_id === selectedAreaId) ?? null,
    [deltaFeatures, selectedAreaId]
  )

  // ── Spike context: 6-month rolling baseline ─────────────────────────────
  const spikeContext = useMemo(() => {
    if (!currentData?.alert_spike || !features || !meta) return null
    const monthIdx = meta.months.indexOf(currentMonth)
    if (monthIdx < 3) return null   // not enough history

    const baseline = meta.months
      .slice(Math.max(0, monthIdx - 6), monthIdx)
      .map(m => features.find(f => f.area_id === selectedAreaId && f.month === m)?.risk_index)
      .filter(v => v != null)
      .reduce((sum, v, _, arr) => sum + v / arr.length, 0)

    return { baseline }
  }, [currentData, features, meta, currentMonth, selectedAreaId])

  // ── Area name ───────────────────────────────────────────────────────────
  const areaName = currentData?.area_name
    ?? deltaData?.area_name
    ?? selectedAreaId

  if (!currentData && !deltaData) {
    return (
      <div className="p-4 text-xs text-slate-500">
        No data for this area.
      </div>
    )
  }

  return (
    <div className="border-b border-slate-700">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h3 className="text-sm font-semibold text-slate-100 leading-tight">
          {areaName}
        </h3>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-300 text-lg leading-none ml-2 flex-shrink-0"
          title="Deselect"
        >
          ×
        </button>
      </div>

      {/* ── Body ── */}
      <div className="px-4 pb-4 text-xs">
        {mode === 'monthCompare' && deltaData ? (
          <DeltaPanel data={deltaData} monthA={monthA} monthB={monthB} />
        ) : currentData ? (
          <MetricPanel data={currentData} spikeContext={spikeContext} alertThreshold={alertThreshold} />
        ) : null}
      </div>
    </div>
  )
}
