import { useState } from "react";
import { Wand2, LogIn, Loader2 } from "lucide-react";
import { useAuth } from "@app/providers/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = (e) => {
    e.preventDefault();
    if (!username || !password) return;
    setBusy(true);
    setError(null);
    login(username, password)
      .catch(() => setError("Invalid username or password, or that account is inactive."))
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex min-h-[100svh] items-center justify-center bg-[#eef2f6] p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
            <Wand2 className="h-5 w-5" />
          </span>
          <div className="leading-tight">
            <div className="text-lg font-extrabold tracking-tight text-slate-900">FixFlow</div>
            <div className="text-[11px] font-medium text-slate-400">Sign in to continue</div>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label
              htmlFor="username"
              className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-400"
            >
              Username
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. manager"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-800 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-400"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-800 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-600">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !username || !password}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-bold text-white transition active:scale-[0.99] disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            Log in
          </button>
        </form>
      </div>
    </div>
  );
}
