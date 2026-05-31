import { useNavigate, useLocation } from "react-router-dom";
import { Monitor, Smartphone } from "lucide-react";

export default function RoleSwitcher({ compact = false }) {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const isTech = pathname.startsWith("/tech");

  const tab = (active) =>
    `inline-flex items-center gap-1.5 rounded-md font-semibold transition ${
      compact ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm"
    } ${active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`;

  return (
    <div className="inline-flex items-center rounded-lg bg-slate-100 p-0.5 ring-1 ring-inset ring-slate-200">
      <button className={tab(!isTech)} onClick={() => nav("/")} title="Manager view">
        <Monitor className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        Manager
      </button>
      <button className={tab(isTech)} onClick={() => nav("/tech/jobs")} title="Technician view">
        <Smartphone className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        Technician
      </button>
    </div>
  );
}
