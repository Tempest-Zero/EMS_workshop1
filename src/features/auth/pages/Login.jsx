import { useEffect, useState } from "react";
import { Wand2, LogIn, Loader2 } from "lucide-react";
import { useAuth } from "@app/providers/AuthContext";
import { fetchTechnicians } from "@features/auth/data/authApi";
import Avatar from "@shared/ui/Avatar";

export default function Login() {
  const { login } = useAuth();
  const [techs, setTechs] = useState([]);
  const [techId, setTechId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchTechnicians()
      .then(setTechs)
      .catch(() => setError("Couldn't load the team. Is the server reachable?"));
  }, []);

  const submit = (e) => {
    e.preventDefault();
    if (!techId || !pin) return;
    setBusy(true);
    setError(null);
    login(techId, pin)
      .catch(() => setError("Wrong PIN, or that account is inactive."))
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
            <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
              Who are you?
            </div>
            <div className="grid max-h-56 grid-cols-1 gap-1.5 overflow-y-auto">
              {techs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTechId(t.id)}
                  className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition ${
                    techId === t.id
                      ? "border-slate-900 bg-slate-900/5 ring-1 ring-slate-900"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <Avatar name={t.name} color={t.avatar} size="sm" />
                  <div className="leading-tight">
                    <div className="text-sm font-bold text-slate-800">{t.name}</div>
                    <div className="text-[11px] text-slate-400">{t.specialty}</div>
                  </div>
                </button>
              ))}
              {techs.length === 0 && !error && (
                <div className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-400">
                  Loading team…
                </div>
              )}
            </div>
          </div>

          <div>
            <label
              htmlFor="pin"
              className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-400"
            >
              PIN
            </label>
            <input
              id="pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-center text-lg tracking-[0.3em] text-slate-800 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-600">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !techId || !pin}
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
