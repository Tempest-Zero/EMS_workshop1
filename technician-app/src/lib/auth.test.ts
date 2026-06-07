/** Token store tests — AsyncStorage replaced with an in-memory mock. */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { getToken, loadToken, setToken } from "./auth";

jest.mock("@react-native-async-storage/async-storage", () => {
  let store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn((k: string) => Promise.resolve(store[k] ?? null)),
      setItem: jest.fn((k: string, v: string) => {
        store[k] = v;
        return Promise.resolve();
      }),
      removeItem: jest.fn((k: string) => {
        delete store[k];
        return Promise.resolve();
      }),
    },
  };
});

describe("token store", () => {
  it("set then get returns the token synchronously", async () => {
    await setToken("abc123");
    expect(getToken()).toBe("abc123");
    expect(AsyncStorage.setItem).toHaveBeenCalledWith("fixflow_token", "abc123");
  });

  it("clearing removes it", async () => {
    await setToken("abc123");
    await setToken(null);
    expect(getToken()).toBeNull();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("fixflow_token");
  });

  it("loadToken hydrates the in-memory cache from storage", async () => {
    await setToken("persisted");
    // Simulate a fresh start: loadToken should read it back.
    expect(await loadToken()).toBe("persisted");
    expect(getToken()).toBe("persisted");
  });
});
