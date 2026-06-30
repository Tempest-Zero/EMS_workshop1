import { Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@app/providers/AuthContext";
import LogoutButton from "@app/components/LogoutButton";
import { Briefcase, Clock, User } from "lucide-react"; // Matching their icon pack

export default function TechnicianLayout() {
  const { user } = useAuth();
  const location = useLocation();

  // Active link styling matching the dark navy/indigo branding profiles
  const isActive = (path) => location.pathname.startsWith(path);
  const linkClass = (path) =>
    `flex flex-col items-center justify-center flex-1 py-2 text-xs font-medium transition-colors ${
      isActive(path) ? "text-[#0f172a] font-semibold" : "text-gray-500 hover:text-gray-900"
    }`;

  return (
    <div className="min-h-[100svh] bg-[#eef2f6] flex flex-col font-sans antialiased text-slate-900">
      {/* Global Top Navigation Header */}
      <header className="sticky top-0 z-40 flex items-center justify-between h-14 px-4 bg-white border-b border-slate-200/80 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#0f172a] text-white font-bold text-sm shadow-md shadow-slate-900/10">
            FF
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-slate-950">FixFlow</h1>
            <p className="text-[10px] text-slate-500 font-medium -mt-0.5">Technician Portal</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-1 rounded-md">
            {user?.name || "Technician"}
          </span>
          <LogoutButton />
        </div>
      </header>

      {/* Primary Dynamic Content Area */}
      <main className="flex-1 w-full max-w-md mx-auto p-4 pb-24 overflow-y-auto">
        <Outlet />
      </main>

      {/* Sticky Mobile Bottom Tab Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 h-16 bg-white border-t border-slate-200/80 shadow-[0_-4px_12px_rgba(0,0,0,0.03)] flex items-center justify-around px-2">
        <Link to="/my-jobs" className={linkClass("/my-jobs")}>
          <Briefcase className="w-5 h-5 mb-1" />
          <span>My Jobs</span>
        </Link>
        
        <Link to="/clock" className={linkClass("/clock")}>
          <Clock className="w-5 h-5 mb-1" />
          <span>Clock In</span>
        </Link>
      </nav>
    </div>
  );
}