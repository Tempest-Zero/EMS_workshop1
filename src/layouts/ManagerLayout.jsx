import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  ClipboardList,
  CalendarCheck,
  CalendarDays,
  Wrench,
  Settings,
  Menu,
  X,
  Wand2,
} from "lucide-react";
import { WORKSHOP } from "../data/constants";
import { fmtDate, fmtDow } from "../lib/date";
import { TODAY } from "../data/constants";
import RoleSwitcher from "../components/RoleSwitcher";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/technicians", label: "Technicians", icon: Users },
  { to: "/jobs", label: "Jobs", icon: ClipboardList },
  { to: "/attendance", label: "Attendance", icon: CalendarCheck },
  { to: "/schedule", label: "Schedule", icon: CalendarDays },
  { to: "/troubleshooting", label: "Troubleshooting", icon: Wrench },
  { to: "/settings", label: "Settings", icon: Settings },
];

function pageTitle(pathname) {
  if (pathname === "/") return "Dashboard";
  if (pathname.startsWith("/technicians")) return "Technicians";
  if (pathname.startsWith("/jobs")) return "Jobs";
  if (pathname.startsWith("/attendance")) return "Attendance";
  if (pathname.startsWith("/schedule")) return "Schedule";
  if (pathname.startsWith("/troubleshooting")) return "Troubleshooting";
  if (pathname.startsWith("/settings")) return "Settings";
  return "Dashboard";
}

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
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white">
        <Wand2 className="h-5 w-5" />
      </span>
      <div className="leading-tight">
        <div className="text-base font-extrabold tracking-tight text-slate-900">FixFlow</div>
        <div className="text-[11px] font-medium text-slate-400">{WORKSHOP.location}</div>
      </div>
    </div>
  );
}

export default function ManagerLayout() {
  const { pathname } = useLocation();
  const [drawer, setDrawer] = useState(false);

  return (
    <div className="min-h-[100svh] bg-[#eef2f6]">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-slate-200 bg-white md:flex">
        <Brand />
        <NavItems />
        <div className="mt-auto px-4 py-4">
          <RoleSwitcher />
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button
                onClick={() => setDrawer(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavItems onNavigate={() => setDrawer(false)} />
            <div className="mt-auto px-4 py-4">
              <RoleSwitcher />
            </div>
          </div>
        </div>
      )}

      <div className="md:pl-60">
        {/* Top header */}
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur md:px-8">
          <button
            onClick={() => setDrawer(true)}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 md:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-extrabold tracking-tight text-slate-900">
            {pageTitle(pathname)}
          </h1>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden items-center rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 sm:flex">
              {fmtDow(TODAY)}, {fmtDate(TODAY, true)}
            </div>
            <div className="md:hidden">
              <RoleSwitcher compact />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
