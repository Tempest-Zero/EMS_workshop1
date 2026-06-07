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
      setTok(t);
      setTechnician(techJson ? (JSON.parse(techJson) as Technician) : null);
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  // A 401 anywhere drops us back to the login screen.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setTok(null);
      setTechnician(null);
      void AsyncStorage.removeItem(TECH_KEY);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (techId: string, pin: string) => {
    const res = await authApi.login(techId, pin);
    await setToken(res.token);
    await AsyncStorage.setItem(TECH_KEY, JSON.stringify(res.technician));
    setTok(res.token);
    setTechnician(res.technician);
  }, []);

  const logout = useCallback(async () => {
    await setToken(null);
    await AsyncStorage.removeItem(TECH_KEY);
    setTok(null);
    setTechnician(null);
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
