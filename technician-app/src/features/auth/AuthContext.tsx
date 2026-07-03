/**
 * Auth state for the technician app. Token + technician are persisted so the
 * app stays logged in across restarts and works offline (no network needed to
 * restore the session). A 401 from any request clears the session.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { setUnauthorizedHandler } from "../../lib/api";
import { loadToken, setToken } from "../../lib/auth";
import { authApi, type Technician } from "../../lib/authApi";
import { setOutboxPrincipal } from "../../lib/outbox";
import { resumeOutbox } from "../../lib/outboxSync";
import { stopDutyPings } from "../attendance/pingTracker";

const TECH_KEY = "fixflow_tech";

interface AuthState {
  ready: boolean;
  isAuthenticated: boolean;
  technician: Technician | null;
  login: (techId: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setTok] = useState<string | null>(null);
  const [technician, setTechnician] = useState<Technician | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const t = await loadToken();
      const techJson = await AsyncStorage.getItem(TECH_KEY);
      if (!active) return;
      const tech = techJson ? (JSON.parse(techJson) as Technician) : null;
      setTok(t);
      setTechnician(tech);
      // Restored session owns the outbox: tag new writes, adopt legacy v1
      // items, and un-pause a queue parked by an expired token.
      setOutboxPrincipal(tech?.id ?? null);
      if (tech) void resumeOutbox(tech.id);
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  // A 401 anywhere drops us back to the login screen. The outbox is NOT
  // cleared — queued writes (possibly cash) survive logout and resume when
  // their owner signs back in.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setTok(null);
      setTechnician(null);
      setOutboxPrincipal(null);
      void AsyncStorage.removeItem(TECH_KEY);
      void stopDutyPings(); // session ended — stop recording location
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (techId: string, pin: string) => {
    const res = await authApi.login(techId, pin);
    await setToken(res.token);
    await AsyncStorage.setItem(TECH_KEY, JSON.stringify(res.technician));
    setTok(res.token);
    setTechnician(res.technician);
    setOutboxPrincipal(res.technician.id);
    await resumeOutbox(res.technician.id);
  }, []);

  const logout = useCallback(async () => {
    await stopDutyPings(); // privacy: stop location recording before signing out
    await setToken(null);
    await AsyncStorage.removeItem(TECH_KEY);
    setTok(null);
    setTechnician(null);
    setOutboxPrincipal(null);
  }, []);

  return (
    <Ctx.Provider
      value={{ ready, isAuthenticated: !!token, technician, login, logout }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
