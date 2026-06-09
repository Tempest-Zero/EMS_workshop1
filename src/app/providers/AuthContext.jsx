import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getToken, setToken, setUnauthorizedHandler } from "@shared/lib/api";
import { login as apiLogin, me } from "@features/auth/data/authApi";

const AuthContext = createContext(null);

/**
 * Holds the logged-in user (derived from a verified JWT) and exposes
 * `login`/`logout`. On mount it rehydrates from a stored token by calling
 * `/auth/me` (which also validates the token); a 401 anywhere clears it.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // { tech_id, role, name } | null
  const [ready, setReady] = useState(false); // initial token check finished

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    const check = getToken() ? me() : Promise.resolve(null);
    check
      .then((principal) => {
        // The web is the manager console. A non-manager token (e.g. one carried
        // over from the mobile app) must not unlock it.
        if (principal && principal.role !== "manager") {
          setToken(null);
          setUser(null);
          return;
        }
        setUser(principal);
      })
      .catch(() => {
        setToken(null);
        setUser(null);
      })
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(async (techId, pin) => {
    const tech = await apiLogin(techId, pin);
    // Manager-only console: refuse a valid but non-manager login (the picker
    // already lists managers only — this is the enforcement behind it).
    if (tech.role !== "manager") {
      setToken(null);
      throw new Error("not-a-manager");
    }
    setUser({ tech_id: tech.id, role: tech.role, name: tech.name });
    return tech;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = { user, isAuthenticated: Boolean(user), ready, login, logout };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
