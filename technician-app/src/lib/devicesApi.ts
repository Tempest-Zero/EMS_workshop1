/** Push device-token registration (backend notifications slice). */

import { request } from "./api";

export function registerDevice(token: string, platform = "android"): Promise<void> {
  return request<void>("/api/devices", {
    method: "POST",
    body: JSON.stringify({ token, platform }),
  });
}
