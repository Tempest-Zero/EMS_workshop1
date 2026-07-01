import { useState } from "react";
import { ShieldCheck, LogIn, Loader2 } from "lucide-react";
import { useOpsAuth } from "@ops/providers/OpsAuthContext";

export default function OpsLogin() {
  const { login } = useOpsAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = (e) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    login(password)
      .catch(() => setError("Wrong password."))
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex min-h-[100svh] items-center justify-center bg-[#0b1220] p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-slate-950">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div className="leading-tight">
            <div className="text-lg font-extrabold tracking-tight text-slate-100">FixFlow Ops</div>
            <div className="text-[11px] font-medium text-slate-500">Team monitoring console</div>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label
              htmlFor="ops-pw"
              className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500"
            >
              Team password
            </label>
            <input
              id="ops-pw"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm font-medium text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !password}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 text-sm font-bold text-slate-950 transition active:scale-[0.99] disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
