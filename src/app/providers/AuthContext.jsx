import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getToken, setToken, setUnauthorizedHandler } from "@shared/lib/api";
import { login as apiLogin, me } from "@features/auth/data/authApi";

const AuthContext = createContext(null);

/**
 * Holds the logged-in user (derived from a verified JWT) and exposes
 * `login`/`logout`. Exposes full system routing capability for both
 * managers and technicians across the web frame.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // { tech_id, role, name } | null
  const [ready, setReady] = useState(false); // initial token check finished

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    const check = getToken() ? me() : Promise.resolve(null);
    check
      .then((principal) => {
        // Unified web layer: Accept all valid authenticated principals 
        // regardless of whether they are managers or field technicians.
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
    
    // Universal session handler: Accept both technician and manager profiles cleanly
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