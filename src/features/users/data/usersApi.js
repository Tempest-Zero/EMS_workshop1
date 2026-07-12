import { apiGet, apiSend } from "@shared/lib/api";

export async function fetchAllUsers() {
  return apiGet("/api/technicians");
}

export async function createUser(payload) {
  return apiSend("/api/technicians", "POST", payload);
}

export async function updateUser(id, payload) {
  return apiSend(`/api/technicians/${id}`, "PUT", payload);
}
