/** A presentational <select> of Railway service names. */
export default function ServicePicker({ services, value, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm font-semibold text-slate-200 focus:border-emerald-500 focus:outline-none"
    >
      {services.length === 0 && <option value="">No services</option>}
      {services.map((s) => (
        <option key={s.id || s.name} value={s.name}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
