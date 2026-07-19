import { jobsApi, type Job } from "./jobsApi";
import { saveJobsList } from "./jobsCache";
import {
  _resetJobsMemoForTests,
  getJobsList,
  invalidateJobsList,
  peekJobsList,
} from "./jobsMemo";

jest.mock("./jobsApi", () => ({ jobsApi: { list: jest.fn() } }));
jest.mock("./jobsCache", () => ({ saveJobsList: jest.fn(() => Promise.resolve()) }));

const mockedList = jobsApi.list as jest.MockedFunction<typeof jobsApi.list>;
const mockedSave = saveJobsList as jest.MockedFunction<typeof saveJobsList>;

function job(id: string): Job {
  return { id, token: 1 } as unknown as Job;
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetJobsMemoForTests();
});

it("serves the memo without a network call while fresh", async () => {
  mockedList.mockResolvedValue([job("a")]);
  const first = await getJobsList();
  const second = await getJobsList();
  expect(first).toEqual([job("a")]);
  expect(second).toBe(first);
  expect(mockedList).toHaveBeenCalledTimes(1);
});

it("refetches once the freshness window has passed", async () => {
  const now = jest.spyOn(Date, "now");
  now.mockReturnValue(1_000_000);
  mockedList.mockResolvedValue([job("a")]);
  await getJobsList();
  now.mockReturnValue(1_000_000 + 16_000); // past FRESH_MS
  mockedList.mockResolvedValue([job("b")]);
  const later = await getJobsList();
  expect(later).toEqual([job("b")]);
  expect(mockedList).toHaveBeenCalledTimes(2);
  now.mockRestore();
});

it("force bypasses a fresh memo", async () => {
  mockedList.mockResolvedValue([job("a")]);
  await getJobsList();
  await getJobsList({ force: true });
  expect(mockedList).toHaveBeenCalledTimes(2);
});

it("dedupes concurrent callers onto one in-flight request", async () => {
  let release!: (jobs: Job[]) => void;
  mockedList.mockReturnValue(new Promise((r) => (release = r)));
  const p1 = getJobsList();
  const p2 = getJobsList({ force: true });
  release([job("a")]);
  expect(await p1).toEqual([job("a")]);
  expect(await p2).toEqual([job("a")]);
  expect(mockedList).toHaveBeenCalledTimes(1);
});

it("writes through to the persistent offline cache on success", async () => {
  mockedList.mockResolvedValue([job("a")]);
  await getJobsList();
  expect(mockedSave).toHaveBeenCalledWith([job("a")]);
});

it("does not memoize a failure, and peek stays empty", async () => {
  mockedList.mockRejectedValue(new Error("offline"));
  await expect(getJobsList()).rejects.toThrow("offline");
  expect(peekJobsList()).toBeNull();
  mockedList.mockResolvedValue([job("a")]);
  await getJobsList();
  expect(mockedList).toHaveBeenCalledTimes(2);
  expect(peekJobsList()).toEqual([job("a")]);
});

it("invalidateJobsList forces the next call to the network", async () => {
  mockedList.mockResolvedValue([job("a")]);
  await getJobsList();
  invalidateJobsList();
  await getJobsList();
  expect(mockedList).toHaveBeenCalledTimes(2);
});
