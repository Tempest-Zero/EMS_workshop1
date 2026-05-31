// Central status styling — status colors carry the visual meaning of the app.
export const statusConfig = {
  open: {
    key: "open",
    label: "Open",
    dot: "bg-blue-500",
    chip: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200",
    solid: "bg-blue-500 text-white",
    soft: "bg-blue-50",
    softText: "text-blue-700",
    text: "text-blue-600",
    border: "border-blue-200",
    bar: "bg-blue-500",
  },
  waiting: {
    key: "waiting",
    label: "Waiting",
    dot: "bg-amber-500",
    chip: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
    solid: "bg-amber-500 text-white",
    soft: "bg-amber-50",
    softText: "text-amber-700",
    text: "text-amber-600",
    border: "border-amber-200",
    bar: "bg-amber-500",
  },
  ready: {
    key: "ready",
    label: "Ready",
    dot: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
    solid: "bg-emerald-500 text-white",
    soft: "bg-emerald-50",
    softText: "text-emerald-700",
    text: "text-emerald-600",
    border: "border-emerald-200",
    bar: "bg-emerald-500",
  },
  closed: {
    key: "closed",
    label: "Closed",
    dot: "bg-slate-400",
    chip: "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200",
    solid: "bg-slate-500 text-white",
    soft: "bg-slate-50",
    softText: "text-slate-600",
    text: "text-slate-500",
    border: "border-slate-200",
    bar: "bg-slate-400",
  },
};

export const statusOrder = ["open", "waiting", "ready", "closed"];

// Technician presence (attendance) styling
export const presenceConfig = {
  present: { label: "Present", chip: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200", dot: "bg-emerald-500" },
  absent: { label: "Absent", chip: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200", dot: "bg-red-500" },
  field: { label: "On Field", chip: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200", dot: "bg-blue-500" },
  leave: { label: "Leave", chip: "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200", dot: "bg-slate-400" },
  half: { label: "Half-day", chip: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200", dot: "bg-amber-500" },
};
