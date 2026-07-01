/** Dark panel used across the ops console. */
export default function Card({ title, subtitle, action, children, className = "" }) {
  return (
    <div className={`rounded-2xl border border-slate-800 bg-slate-900 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <div className="min-w-0">
            {title && <h3 className="truncate text-sm font-bold text-slate-200">{title}</h3>}
            {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}
