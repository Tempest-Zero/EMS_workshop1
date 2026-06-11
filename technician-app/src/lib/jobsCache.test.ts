/** Jobs read-cache tests — AsyncStorage backed by an in-memory map. */

let mockStore: Record<string, string> = {};
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: (k: string) => Promise.resolve(mockStore[k] ?? null),
    setItem: (k: string, v: string) => {
      mockStore[k] = v;
      return Promise.resolve();
    },
    getAllKeys: () => Promise.resolve(Object.keys(mockStore)),
    multiRemove: (keys: string[]) => {
      for (const k of keys) delete mockStore[k];
      return Promise.resolve();
    },
  },
}));

import type { Job, JobDetail } from "./jobsApi";
import { loadJobDetail, loadJobsList, saveJobDetail, saveJobsList } from "./jobsCache";

const job = (over: Partial<Job> = {}): Job => ({
  id: "j1",
  token: 1051,
  shop_id: "default",
  status: "open",
  job_type: "home-visit",
  customer_name: "Yusuf Khan",
  customer_phone: "0312-6677889",
  customer_address: "House 31, Phase 2, DHA, Karachi",
  appliance_type: "Split AC",
  appliance_brand: "Gree",
  appliance_model: null,
  problem: "Not cooling",
  assigned_tech_id: "t1",
  preferred_date: null,
  time_window: null,
  bill_original_paisa: null,
  bill_negotiated_paisa: null,
  bill_status: "none",
  created_at: "2026-06-10T09:00:00Z",
  updated_at: "2026-06-10T09:00:00Z",
  ...over,
});

const detail = (over: Partial<JobDetail> = {}): JobDetail => ({
  ...job(),
  events: [],
  completion: null,
  payments: [],
  received_paisa: 0,
  balance_paisa: 0,
  locations: [],
  route: null,
  ...over,
});

beforeEach(() => {
  mockStore = {};
});

describe("jobs list cache", () => {
  it("round-trips the last synced list with a savedAt stamp", async () => {
    await saveJobsList([job(), job({ id: "j2", token: 1052 })]);
    const cached = await loadJobsList();
    expect(cached).not.toBeNull();
    expect(cached?.data.map((j) => j.id)).toEqual(["j1", "j2"]);
    expect(Date.parse(cached?.savedAt ?? "")).not.toBeNaN();
  });

  it("returns null when nothing is cached", async () => {
    expect(await loadJobsList()).toBeNull();
  });

  it("treats a corrupt entry as no cache", async () => {
    mockStore["jobs.cache.list.v1"] = "{corrupt!!";
    expect(await loadJobsList()).toBeNull();
  });
});

describe("job detail cache", () => {
  it("round-trips a detail by job id", async () => {
    await saveJobDetail(detail());
    const cached = await loadJobDetail("j1");
    expect(cached?.data.customer_address).toBe("House 31, Phase 2, DHA, Karachi");
    expect(await loadJobDetail("nope")).toBeNull();
  });

  it("prunes cached details for jobs no longer in the saved list", async () => {
    await saveJobDetail(detail({ id: "j1" }));
    await saveJobDetail(detail({ id: "gone", token: 1099 }));
    await saveJobsList([job({ id: "j1" })]); // server list no longer has "gone"
    expect(await loadJobDetail("j1")).not.toBeNull();
    expect(await loadJobDetail("gone")).toBeNull();
  });
});
