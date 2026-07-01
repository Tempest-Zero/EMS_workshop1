import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getToken, setToken, setUnauthorizedHandler } from "@shared/lib/api";
import { login as apiLogin } from "@ops/data/opsAuthApi";

const OpsAuthContext = createContext(null);

/**
 * Holds the ops console session (a shared-password token from ops-server.mjs)
 * and exposes `login`/`logout`. There is no user identity — this is a team tool,
 * not per-person accounts. A 401 from any /api/ops call (expired token, or the
 * service was redeployed) drops the user back to the password screen.
 */
export function OpsAuthProvider({ children }) {
  // Initialise straight from the stored token — no async session check, so the
  // first render is already correct (no login flash, no setState-in-effect).
  const [authed, setAuthed] = useState(() => Boolean(getToken()));

  useEffect(() => {
    setUnauthorizedHandler(() => setAuthed(false));
  }, []);

  const login = useCallback(async (password) => {
    const { token } = await apiLogin(password);
    setToken(token);
    setAuthed(true);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setAuthed(false);
  }, []);

  const value = { isAuthenticated: authed, ready: true, login, logout };
  return <OpsAuthContext.Provider value={value}>{children}</OpsAuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOpsAuth() {
  const ctx = useContext(OpsAuthContext);
  if (!ctx) throw new Error("useOpsAuth must be used within OpsAuthProvider");
  return ctx;
}
