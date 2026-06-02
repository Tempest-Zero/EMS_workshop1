/**
 * Unit tests for the upload pipeline. Mocks `api`, `expo-file-system`, and
 * `compressVideo` so this runs without a phone / network / Supabase.
 */

import * as FileSystem from "expo-file-system";

import { api, type MediaItem } from "../../lib/api";
import { compressVideo } from "../../lib/compress";
import { uploadMedia } from "./uploadMedia";

// Explicit mock factories — otherwise Jest auto-mock loads the real modules,
// and react-native-compressor (a native module) explodes outside a real RN env.
jest.mock("../../lib/api", () => ({
  api: {
    requestUpload: jest.fn(),
    completeUpload: jest.fn(),
    listMedia: jest.fn(),
    deleteMedia: jest.fn(),
  },
}));
jest.mock("../../lib/compress", () => ({
  compressVideo: jest.fn(),
}));
jest.mock("expo-file-system", () => ({
  uploadAsync: jest.fn(),
  getInfoAsync: jest.fn(),
}));

const mockedApi = api as jest.Mocked<typeof api>;
const mockedFs = FileSystem as jest.Mocked<typeof FileSystem>;
const mockedCompress = compressVideo as jest.MockedFunction<typeof compressVideo>;

const FINAL_ITEM: MediaItem = {
  id: "mid-1",
  job_id: "job",
  phase: "before",
  type: "video",
  filename: "v.mp4",
  storage_path: "job/before/x.mp4",
  content_type: "video/mp4",
  size_bytes: 1234,
  status: "uploaded",
  created_at: "2026-06-02T00:00:00Z",
  uploaded_at: "2026-06-02T00:00:01Z",
  playback_url: "https://signed/play",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.requestUpload.mockResolvedValue({
    media_id: "mid-1",
    signed_url: "https://signed/up",
    storage_path: "job/before/x.mp4",
    expires_in: 600,
  });
  mockedApi.completeUpload.mockResolvedValue(FINAL_ITEM);
  // jest.Mocked types getInfoAsync as overloaded; cast through unknown for the simpler return.
  (mockedFs.uploadAsync as unknown as jest.Mock).mockResolvedValue({
    status: 200,
    headers: {},
    body: "",
  });
  (mockedFs.getInfoAsync as unknown as jest.Mock).mockResolvedValue({
    exists: true,
    size: 1234,
    uri: "file://compressed.mp4",
  });
  mockedCompress.mockResolvedValue("file://compressed.mp4");
});

describe("uploadMedia", () => {
  it("compresses videos before uploading", async () => {
    await uploadMedia({
      jobId: "job",
      phase: "before",
      type: "video",
      uri: "file://raw.mp4",
      filename: "v.mp4",
      contentType: "video/mp4",
    });

    expect(mockedCompress).toHaveBeenCalledWith("file://raw.mp4");
    expect(mockedFs.uploadAsync).toHaveBeenCalledWith(
      "https://signed/up",
      "file://compressed.mp4",
      expect.objectContaining({ httpMethod: "PUT" }),
    );
  });

  it("skips compression for photos", async () => {
    await uploadMedia({
      jobId: "job",
      phase: "after",
      type: "photo",
      uri: "file://photo.jpg",
      filename: "p.jpg",
      contentType: "image/jpeg",
    });

    expect(mockedCompress).not.toHaveBeenCalled();
    expect(mockedFs.uploadAsync).toHaveBeenCalledWith(
      "https://signed/up",
      "file://photo.jpg",
      expect.objectContaining({ httpMethod: "PUT" }),
    );
  });

  it("throws if storage upload fails and never finalizes", async () => {
    (mockedFs.uploadAsync as unknown as jest.Mock).mockResolvedValue({
      status: 403,
      headers: {},
      body: "forbidden",
    });

    await expect(
      uploadMedia({
        jobId: "job",
        phase: "before",
        type: "photo",
        uri: "file://p.jpg",
        filename: "p.jpg",
        contentType: "image/jpeg",
      }),
    ).rejects.toThrow(/Upload to storage failed.*403/);

    expect(mockedApi.completeUpload).not.toHaveBeenCalled();
  });

  it("finalizes the row with the local file size", async () => {
    const item = await uploadMedia({
      jobId: "job",
      phase: "before",
      type: "photo",
      uri: "file://p.jpg",
      filename: "p.jpg",
      contentType: "image/jpeg",
    });

    expect(mockedApi.completeUpload).toHaveBeenCalledWith("job", "mid-1", {
      size_bytes: 1234,
    });
    expect(item.status).toBe("uploaded");
    expect(item.playback_url).toBe("https://signed/play");
  });
});
