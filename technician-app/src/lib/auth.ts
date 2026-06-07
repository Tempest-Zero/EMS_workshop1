/**
 * JWT storage for the technician app. The login token is cached in memory (so
 * the api client can attach it synchronously) and persisted to AsyncStorage so
 * the technician stays logged in across app restarts.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_KEY = "fixflow_token";

let cached: string | null = null;

/** Load the persisted token into memory. Call once on app start. */
export async function loadToken(): Promise<string | null> {
  cached = await AsyncStorage.getItem(TOKEN_KEY);
  return cached;
}

/** The current token, synchronously (for attaching to requests). */
export function getToken(): string | null {
  return cached;
}

export async function setToken(token: string | null): Promise<void> {
  cached = token;
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}
