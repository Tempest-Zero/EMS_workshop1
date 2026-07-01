import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  Activity,
  HeartPulse,
  Gauge,
  Rocket,
  ScrollText,
  Cpu,
  Bug,
  Menu,
  X,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import { useOpsAuth } from "@ops/providers/OpsAuthContext";

const NAV = [
  { to: "/", label: "Overview", icon: Activity, end: true },
  { to: "/health", label: "Health", icon: HeartPulse },
  { to: "/metrics", label: "API metrics", icon: Gauge },
  { to: "/deployments", label: "Deployments", icon: Rocket },
  { to: "/logs", label: "Logs", icon: ScrollText },
  { to: "/resources", label: "Resources", icon: Cpu },
  { to: "/errors", label: "Errors", icon: Bug },
];

function NavItems({ onNavigate }) {
  return (
    <nav className="flex flex-col gap-1 px-3">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
              isActive
                ? "bg-slate-100 text-slate-900 shadow-sm"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            }`
          }
        >
          <Icon className="h-[18px] w-[18px]" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-5 py-5">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-slate-950">
        <ShieldCheck className="h-5 w-5" />
      </span>
      <div className="leading-tight">
        <div className="text-base font-extrabold tracking-tight text-slate-100">FixFlow Ops</div>
        <div className="text-[11px] font-medium text-slate-500">Read-only console</div>
      </div>
    </div>
  );
}

function SignOut() {
  const { logout } = useOpsAuth();
  return (
    <button
      onClick={logout}
      title="Sign out"
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
    >
      <LogOut className="h-3.5 w-3.5" />
      Sign out
    </button>
  );
}

export default function OpsLayout() {
  const [drawer, setDrawer] = useState(false);

  return (
    <div className="min-h-[100svh] bg-[#0b1220] text-slate-200">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-slate-800 bg-slate-950 md:flex">
        <Brand />
        <NavItems />
        <div className="mt-auto px-4 py-4">
          <SignOut />
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-slate-950 shadow-xl">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button
                onClick={() => setDrawer(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavItems onNavigate={() => setDrawer(false)} />
            <div className="mt-auto px-4 py-4">
              <SignOut />
            </div>
          </div>
        </div>
      )}

      <div className="md:pl-60">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-800 bg-slate-950/80 px-4 py-3 backdrop-blur md:px-8">
          <button
            onClick={() => setDrawer(true)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 md:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-extrabold tracking-tight text-slate-100">Production Ops</h1>
          <div className="ml-auto md:hidden">
            <SignOut />
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
