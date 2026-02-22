/**
 * ControlsBar
 * The top control strip containing:
 *   - Timeline slider (monthIndex → which month to show on the map)
 *   - Mode toggle: "Count vs Risk" (metricCompare) | "Month Comparison" (monthCompare)
 *   - Metric toggle (metricCompare only): Risk Index | Theft Count
 *   - Month A / Month B selectors (monthCompare only)
 */

// ── helpers ─────────────────────────────────────────────────────────────────

/** Format a 'YYYY-MM' string to something readable, e.g. 'Jan 2025' */
function fmtMonth(ym) {
  if (!ym) return '—'
  const [y, m] = ym.split('-')
  return new Date(+y, +m - 1, 1).toLocaleString('en-GB', { month: 'short', year: 'numeric' })
}

// ── sub-components ───────────────────────────────────────────────────────────

function ModeButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
        active
          ? 'bg-orange-500 text-white'
          : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
      }`}
    >
      {children}
    </button>
  )
}

function MetricButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
        active
          ? 'bg-sky-600 text-white'
          : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
      }`}
    >
      {children}
    </button>
  )
}

// ── main component ───────────────────────────────────────────────────────────

export default function ControlsBar({
  meta,
  mode,          setMode,
  monthIndex,    setMonthIndex,
  monthA,        setMonthA,
  monthB,        setMonthB,
  displayMetric, setDisplayMetric,
  showDelta,     setShowDelta,      // monthCompare sub-mode: false=[A|B]  true=[Δ]
}) {
  if (!meta?.months) return null
  const months = meta.months
  const maxIdx = months.length - 1
  const currentLabel = fmtMonth(months[monthIndex])

  return (
    <div className="flex-shrink-0 bg-slate-800 border-b border-slate-700 px-4 py-2 flex flex-wrap items-center gap-x-6 gap-y-2">

      {/* ── Timeline slider ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 min-w-[260px] flex-1">
        <span className="text-xs text-slate-500 w-16 text-right shrink-0">
          {fmtMonth(months[0])}
        </span>
        <div className="flex flex-col flex-1 gap-0.5">
          <input
            type="range"
            min={0}
            max={maxIdx}
            step={1}
            value={monthIndex}
            onChange={e => setMonthIndex(+e.target.value)}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer
                       bg-slate-600 accent-orange-400"
          />
          <span className="text-center text-xs font-medium text-orange-300">
            {currentLabel}
          </span>
        </div>
        <span className="text-xs text-slate-500 w-16 shrink-0">
          {fmtMonth(months[maxIdx])}
        </span>
      </div>

      {/* ── Mode toggle ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-slate-500">Mode:</span>
        <ModeButton
          active={mode === 'metricCompare'}
          onClick={() => setMode('metricCompare')}
        >
          Count vs Risk
        </ModeButton>
        <ModeButton
          active={mode === 'monthCompare'}
          onClick={() => setMode('monthCompare')}
        >
          Month Comparison
        </ModeButton>
      </div>

      {/* ── Metric selector (metricCompare only) ──────────────────────── */}
      {mode === 'metricCompare' && (
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-slate-500">Show:</span>
          <MetricButton
            active={displayMetric === 'risk_index'}
            onClick={() => setDisplayMetric('risk_index')}
          >
            Risk Index
          </MetricButton>
          <MetricButton
            active={displayMetric === 'theft_count'}
            onClick={() => setDisplayMetric('theft_count')}
          >
            Theft Count
          </MetricButton>
        </div>
      )}

      {/* ── Month A / B selectors + view sub-mode (monthCompare only) ── */}
      {mode === 'monthCompare' && (
        <div className="flex items-center gap-3 flex-wrap shrink-0">
          {/* Month A selector */}
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="text-sky-400 font-medium">A:</span>
            <select
              value={monthA}
              onChange={e => setMonthA(e.target.value)}
              className="bg-slate-700 border border-slate-600 text-slate-200 rounded px-2 py-0.5 text-xs"
            >
              {months.map(m => (
                <option key={m} value={m}>{fmtMonth(m)}</option>
              ))}
            </select>
          </label>

          <span className="text-slate-600 text-sm">→</span>

          {/* Month B selector */}
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="text-orange-400 font-medium">B:</span>
            <select
              value={monthB}
              onChange={e => setMonthB(e.target.value)}
              className="bg-slate-700 border border-slate-600 text-slate-200 rounded px-2 py-0.5 text-xs"
            >
              {months.map(m => (
                <option key={m} value={m}>{fmtMonth(m)}</option>
              ))}
            </select>
          </label>

          {monthA === monthB && (
            <span className="text-xs text-yellow-500">⚠ Same month</span>
          )}

          {/* ── Sub-mode: A vs B side-by-side  OR  Δ delta map ── */}
          <div className="flex items-center gap-1.5 border-l border-slate-600 pl-3">
            <span className="text-xs text-slate-500">Map:</span>
            <MetricButton
              active={!showDelta}
              onClick={() => setShowDelta(false)}
            >
              A | B
            </MetricButton>
            <MetricButton
              active={showDelta}
              onClick={() => setShowDelta(true)}
            >
              Δ Delta
            </MetricButton>
          </div>
        </div>
      )}
    </div>
  )
}
