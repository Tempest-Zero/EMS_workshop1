import { useEffect, useRef } from "react";
import { fmtClock, severityTone } from "@features/ops/lib/format";

const DOT = {
  down: "bg-red-500",
  degraded: "bg-amber-400",
  neutral: "bg-slate-600",
};

/** A tailing log view: monospace lines, severity dot, newest at the bottom. */
export default function LogViewer({ lines }) {
  const endRef = useRef(null);

  // Tail: keep the latest line in view as new ones arrive.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  if (!lines?.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-800 px-4 py-10 text-center text-sm text-slate-500">
        No log lines for this selection.
      </div>
    );
  }

  return (
    <div className="max-h-[60vh] overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-2 font-mono text-xs leading-relaxed">
      {lines.map((line, i) => (
        <div key={i} className="flex gap-2 px-1 py-0.5 hover:bg-slate-900">
          <span
            className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[severityTone(line.severity)]}`}
          />
          <span className="shrink-0 text-slate-600">{fmtClock(line.timestamp)}</span>
          <span className="whitespace-pre-wrap break-all text-slate-300">{line.message}</span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
