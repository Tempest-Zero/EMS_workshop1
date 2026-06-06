import { LogOut } from "lucide-react";
import { useAuth } from "@app/providers/AuthContext";

export default function LogoutButton({ compact = false }) {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <button
      onClick={logout}
      title={`Log out${user.name ? ` (${user.name})` : ""}`}
      className={`inline-flex items-center gap-1.5 rounded-lg font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 ${
        compact ? "px-2 py-1 text-xs" : "px-2.5 py-1.5 text-sm"
      }`}
    >
      <LogOut className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
      {!compact && "Log out"}
    </button>
  );
}
