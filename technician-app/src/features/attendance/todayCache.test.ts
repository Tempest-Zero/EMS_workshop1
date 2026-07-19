import { attendanceApi, type TodayStatus } from "../../lib/attendanceApi";
import { _resetTodayCacheForTests, getToday, invalidateToday } from "./todayCache";

jest.mock("../../lib/attendanceApi", () => ({ attendanceApi: { today: jest.fn() } }));

const mockedToday = attendanceApi.today as jest.MockedFunction<typeof attendanceApi.today>;

function status(techId: string, clocked_in: boolean): TodayStatus {
  return { tech_id: techId, clocked_in, last_in: null, last_out: null };
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetTodayCacheForTests();
});

it("shares one fetch across callers within the freshness window", async () => {
  mockedToday.mockResolvedValue(status("t1", true));
  const a = await getToday("t1");
  const b = await getToday("t1");
  expect(a.clocked_in).toBe(true);
  expect(b).toBe(a);
  expect(mockedToday).toHaveBeenCalledTimes(1);
});

it("caches per tech, not globally", async () => {
  mockedToday.mockImplementation((id: string) => Promise.resolve(status(id, id === "t1")));
  expect((await getToday("t1")).clocked_in).toBe(true);
  expect((await getToday("t2")).clocked_in).toBe(false);
  expect(mockedToday).toHaveBeenCalledTimes(2);
});

it("invalidateToday(techId) forces a refetch for that tech only", async () => {
  mockedToday.mockImplementation((id: string) => Promise.resolve(status(id, false)));
  await getToday("t1");
  await getToday("t2");
  invalidateToday("t1");
  await getToday("t1"); // refetch
  await getToday("t2"); // still cached
  expect(mockedToday).toHaveBeenCalledTimes(3);
});

it("dedupes concurrent callers onto one in-flight request", async () => {
  let release!: (s: TodayStatus) => void;
  mockedToday.mockReturnValue(new Promise((r) => (release = r)));
  const p1 = getToday("t1");
  const p2 = getToday("t1");
  release(status("t1", true));
  expect((await p1).clocked_in).toBe(true);
  expect((await p2).clocked_in).toBe(true);
  expect(mockedToday).toHaveBeenCalledTimes(1);
});

it("does not cache a failure", async () => {
  mockedToday.mockRejectedValue(new Error("offline"));
  await expect(getToday("t1")).rejects.toThrow("offline");
  mockedToday.mockResolvedValue(status("t1", true));
  expect((await getToday("t1")).clocked_in).toBe(true);
  expect(mockedToday).toHaveBeenCalledTimes(2);
});

it("expires after the freshness window", async () => {
  const now = jest.spyOn(Date, "now");
  now.mockReturnValue(5_000_000);
  mockedToday.mockResolvedValue(status("t1", false));
  await getToday("t1");
  now.mockReturnValue(5_000_000 + 31_000); // past FRESH_MS
  mockedToday.mockResolvedValue(status("t1", true));
  expect((await getToday("t1")).clocked_in).toBe(true);
  expect(mockedToday).toHaveBeenCalledTimes(2);
  now.mockRestore();
});
