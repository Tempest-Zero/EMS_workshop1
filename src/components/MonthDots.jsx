import { attendance } from "../data/attendance";
import { parseISO } from "../lib/date";

export const ATT_CELL = {
  present: "bg-emerald-500",
  field: "bg-blue-500",
  half: "bg-amber-400",
  leave: "bg-slate-300",
  absent: "bg-red-500",
  holiday: "bg-slate-100",
};

const LEGEND = [
  ["present", "Present"],
  ["field", "Field"],
  ["half", "Half-day"],
  ["leave", "Leave"],
  ["absent", "Absent"],
  ["holiday", "Holiday"],
];

export default function MonthDots({ techId, showLegend = true, showNums = false }) {
  const rows = attendance[techId] || [];
  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5">
        {rows.map((r) => {
          const day = parseISO(r.date).getDate();
          return (
            <div
              key={r.date}
              title={`${r.date} · ${r.status}`}
              className={`flex aspect-square items-center justify-center rounded-md text-[10px] font-bold text-white ${ATT_CELL[r.status]} ${
                r.status === "holiday" ? "text-slate-300" : ""
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
            <span key={key} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
              <span className={`h-2.5 w-2.5 rounded-sm ${ATT_CELL[key]}`} />
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
