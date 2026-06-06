import { NavLink, Outlet } from "react-router-dom";
import { ClipboardList, Clock, Wrench, User, CalendarDays } from "lucide-react";
import PhoneFrame from "@app/layouts/PhoneFrame";
import RoleSwitcher from "@app/components/RoleSwitcher";
import LogoutButton from "@app/components/LogoutButton";
import { useApp } from "@app/providers/AppContext";
import { techById } from "@features/technicians/data/technicians";
import Avatar from "@shared/ui/Avatar";

const TABS = [
  { to: "/tech/jobs", label: "My Jobs", icon: ClipboardList },
  { to: "/tech/clock", label: "Clock In", icon: Clock },
  { to: "/tech/troubleshoot", label: "Diagnose", icon: Wrench },
  { to: "/tech/profile", label: "Profile", icon: User },
];

export default function TechLayout() {
  const { currentTechId } = useApp();
  const me = techById(currentTechId);

  return (
    <PhoneFrame>
      {/* Top bar */}
      <header className="z-10 flex shrink-0 items-center gap-2.5 border-b border-slate-200 bg-white px-4 py-3">
        <Avatar name={me.name} color={me.avatar} size="sm" />
        <div className="leading-tight">
          <div className="text-sm font-bold text-slate-900">{me.name}</div>
          <div className="text-[11px] font-medium text-slate-400">{me.specialty}</div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <NavLink
            to="/tech/schedule"
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="My week"
          >
            <CalendarDays className="h-5 w-5" />
          </NavLink>
          <RoleSwitcher compact />
          <LogoutButton compact />
        </div>
      </header>

      {/* Scrollable content */}
      <main className="scrollbar-thin flex-1 overflow-y-auto bg-slate-50">
        <Outlet />
      </main>

      {/* Bottom tab bar */}
      <nav className="z-10 grid shrink-0 grid-cols-4 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
        {TABS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-bold transition ${
                isActive ? "text-slate-900" : "text-slate-400 hover:text-slate-600"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`flex h-8 w-12 items-center justify-center rounded-full transition ${
                    isActive ? "bg-slate-900 text-white" : ""
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </span>
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </PhoneFrame>
  );
}
