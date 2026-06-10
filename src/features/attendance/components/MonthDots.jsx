/**
 * A month of attendance as a 7-wide dot grid. Purely presentational: callers
 * pass the `cells` from the live `/api/attendance/grid` endpoint
 * (`[{ day, status, late }]`) — this component holds no data of its own.
 */

import { parseISO } from "@shared/lib/date";
import { ATT_CELL } from "@features/attendance/lib/cells";

const LEGEND = [
  ["present", "Present"],
  ["field", "Field"],
  ["half", "Half-day"],
  ["leave", "Leave"],
  ["absent", "Absent"],
  ["holiday", "Holiday"],
];

export default function MonthDots({ cells = [], showLegend = true, showNums = false }) {
  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((c) => {
          const day = parseISO(c.day).getDate();
          return (
            <div
              key={c.day}
              title={`${c.day} · ${c.status}${c.late ? " · late" : ""}`}
              className={`flex aspect-square items-center justify-center rounded-md text-[10px] font-bold text-white ${ATT_CELL[c.status]} ${
                c.status === "holiday" ? "text-slate-300" : ""
              }`}
            >
              {showNums ? day : ""}
            </div>
          );
        })}
      </div>
      {showLegend && (
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
          {LEGEND.map(([key, label]) => (
            <span
              key={key}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500"
            >
              <span className={`h-2.5 w-2.5 rounded-sm ${ATT_CELL[key]}`} />
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
