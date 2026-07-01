/**
 * A dependency-free SVG area chart for a single Railway metric series. The repo
 * ships no charting library on purpose; this keeps the ops bundle small. Swap in
 * Recharts later if richer interaction is ever wanted.
 *
 * The y-axis is baselined at 0 (not min..max), so a low-but-steady series reads
 * as "low", not as a broken-looking full-height squiggle. Each series shows its
 * unit and the min/max of the window.
 */
const W = 320;
const H = 80;
const PAD = 4;

// Railway measurement → friendly label + unit. CPU_USAGE is reported in vCPU
// (fractions of a core), memory/network in GB.
const META = {
  CPU_USAGE: { label: "CPU", unit: "vCPU", digits: 3 },
  MEMORY_USAGE_GB: { label: "Memory", unit: "GB", digits: 2 },
  NETWORK_RX_GB: { label: "Network in", unit: "GB", digits: 3 },
  NETWORK_TX_GB: { label: "Network out", unit: "GB", digits: 3 },
};

function fmt(value, meta) {
  if (value == null) return "—";
  return `${value.toFixed(meta.digits)} ${meta.unit}`;
}

export default function MetricChart({ series }) {
  const measurement = series?.measurement || "metric";
  const meta = META[measurement] || { label: measurement, unit: "", digits: 2 };
  const points = series?.points ?? [];
  const values = points.map((p) => p.value);
  const latest = values.length ? values[values.length - 1] : null;
  const min = values.length ? Math.min(...values) : null;
  const max = values.length ? Math.max(...values) : null;

  // Baseline at 0 with a little headroom; a flat-zero series stays pinned to the
  // floor instead of filling the panel.
  const top = (max ?? 0) * 1.15 || 1;

  let path = "";
  let area = "";
  if (points.length > 1) {
    const stepX = (W - PAD * 2) / (points.length - 1);
    const coords = points.map((p, i) => {
      const x = PAD + i * stepX;
      const y = PAD + (H - PAD * 2) * (1 - p.value / top);
      return [x, y];
    });
    path = coords
      .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" ");
    area = `${path} L${coords[coords.length - 1][0].toFixed(1)},${H - PAD} L${coords[0][0].toFixed(1)},${H - PAD} Z`;
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-slate-400">{meta.label}</span>
        <span className="text-sm font-bold text-slate-100">{fmt(latest, meta)}</span>
      </div>
      {points.length > 1 ? (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-full" preserveAspectRatio="none">
            {/* zero baseline */}
            <line
              x1={PAD}
              y1={H - PAD}
              x2={W - PAD}
              y2={H - PAD}
              stroke="rgb(51 65 85)"
              strokeWidth="0.5"
              strokeDasharray="3 3"
            />
            <path d={area} fill="rgb(16 185 129 / 0.15)" />
            <path d={path} fill="none" stroke="rgb(16 185 129)" strokeWidth="1.5" />
          </svg>
          <div className="mt-1 flex justify-between text-[10px] tabular-nums text-slate-600">
            <span>min {fmt(min, meta)}</span>
            <span>0-baselined · max {fmt(max, meta)}</span>
          </div>
        </>
      ) : (
        <div className="flex h-20 items-center justify-center text-xs text-slate-600">
          {points.length === 1 ? fmt(latest, meta) : "Not enough data points yet."}
        </div>
      )}
    </div>
  );
}
