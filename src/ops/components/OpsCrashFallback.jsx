import { AlertTriangle } from "lucide-react";

/** Shown by the root error boundary instead of a blank screen on a crash. */
export default function OpsCrashFallback() {
  return (
    <div className="flex min-h-[100svh] items-center justify-center bg-[#0b1220] p-6">
      <div className="max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-amber-400" />
        <div className="mt-3 text-lg font-bold text-slate-100">Ops console hit an error</div>
        <p className="mt-1 text-sm text-slate-400">
          The page crashed. Reload to try again — if it persists, the backend may be unreachable.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-900 transition active:scale-[0.99]"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
