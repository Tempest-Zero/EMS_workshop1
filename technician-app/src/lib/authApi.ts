/**
 * Identity endpoints (login, roster, me). Mirrors the backend `identity` slice.
 */

import { request } from "./api";

export interface Technician {
  id: string;
  name: string;
  specialty: string | null;
  avatar: string | null;
  role: string;
  active: boolean;
}

export interface LoginResponse {
  token: string;
  technician: Technician;
}

export interface Principal {
  tech_id: string;
  role: string;
  name: string;
}

export const authApi = {
  /** Public roster for the login picker (never includes pin_hash). */
  roster: () => request<Technician[]>("/api/technicians"),

  login: (techId: string, pin: string) =>
    request<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ tech_id: techId, pin }),
    }),

  me: () => request<Principal>("/api/auth/me"),
};
