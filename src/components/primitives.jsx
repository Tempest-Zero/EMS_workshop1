export function Card({ className = "", children, ...props }) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function SectionHeader({ title, sub, action, className = "" }) {
  return (
    <div className={`flex items-end justify-between gap-3 ${className}`}>
      <div>
        <h2 className="text-base font-bold tracking-tight text-slate-800">{title}</h2>
        {sub && <p className="mt-0.5 text-sm text-slate-500">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, sub, className = "" }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-12 text-center ${className}`}>
      {Icon && <Icon className="h-8 w-8 text-slate-300" />}
      <p className="text-sm font-semibold text-slate-600">{title}</p>
      {sub && <p className="max-w-xs text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

const variants = {
  primary: "bg-slate-900 text-white hover:bg-slate-800 focus-visible:ring-slate-400",
  secondary: "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 focus-visible:ring-slate-400",
  ghost: "text-slate-600 hover:bg-slate-100 focus-visible:ring-slate-300",
  success: "bg-emerald-600 text-white hover:bg-emerald-500 focus-visible:ring-emerald-400",
  danger: "bg-red-600 text-white hover:bg-red-500 focus-visible:ring-red-400",
  warning: "bg-amber-500 text-white hover:bg-amber-400 focus-visible:ring-amber-300",
  blue: "bg-blue-600 text-white hover:bg-blue-500 focus-visible:ring-blue-400",
  outlineDanger: "bg-white text-red-600 ring-1 ring-inset ring-red-200 hover:bg-red-50 focus-visible:ring-red-300",
};
const sizes = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-3 text-base",
};

export function Button({ variant = "secondary", size = "md", className = "", type = "button", ...props }) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${sizes[size]} ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200";

export function Field({ label, hint, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}
