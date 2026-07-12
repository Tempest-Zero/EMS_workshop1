import { useState } from "react";
import { ShieldAlert, Loader2, Save } from "lucide-react";
import { useAuth } from "@app/providers/AuthContext";
import { changePassword } from "../data/authApi";
import { Button, inputClass } from "@shared/ui/primitives";

export function ForceChangePassword() {
  const { refreshUser } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changePassword(password);
      await refreshUser();
    } catch (err) {
      setError(err.message || "Failed to update password. Ensure it meets complexity requirements.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[100svh] items-center justify-center bg-[#eef2f6] p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3 text-amber-600">
          <ShieldAlert className="h-8 w-8" />
          <div className="leading-tight text-slate-900">
            <div className="text-lg font-extrabold tracking-tight">Security Update Required</div>
            <div className="text-sm font-medium text-slate-500">Please set a new password to continue</div>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label
              htmlFor="new-password"
              className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500"
            >
              New Password
            </label>
            <input
              id="new-password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-slate-400">
              Min 8 characters, must include uppercase, number, and special character.
            </p>
          </div>

          <div>
            <label
              htmlFor="confirm-password"
              className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500"
            >
              Confirm Password
            </label>
            <input
              id="confirm-password"
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputClass}
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-600">
              {error}
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={busy || !password || !confirmPassword}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Update Password
          </Button>
        </form>
      </div>
    </div>
  );
}
