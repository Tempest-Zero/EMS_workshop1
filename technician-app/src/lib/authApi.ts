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
  must_change_password: boolean;
}

export interface LoginResponse {
  token: string;
  technician: Technician;
}

export interface Principal {
  tech_id: string;
  role: string;
  name: string;
  must_change_password: boolean;
}

export const authApi = {
  /** Public roster */
  roster: () => request<Technician[]>("/api/technicians/roster"),

  login: (username: string, password: string) =>
    request<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  changePassword: (password: string) =>
    request<void>("/api/technicians/password", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  me: () => request<Principal>("/api/auth/me"),
};
