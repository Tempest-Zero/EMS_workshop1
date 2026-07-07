/**
 * On-device video compression.
 *
 * Why on-device (not server-side): mobile data in Pakistan is slow and
 * metered, the backend rejects oversized uploads at finalize (see
 * `r2_max_upload_bytes`), and the compressed 720p clip is plenty to see
 * whether an appliance is running correctly.
 * Targets come from `config.compress` so we can dial them up on a paid tier
 * without touching this file.
 *
 * `react-native-compressor` is a native module → only works in an EAS dev
 * build, not in Expo Go.
 */

import { Video } from "react-native-compressor";

import { config } from "./config";

export async function compressVideo(sourceUri: string): Promise<string> {
  return Video.compress(sourceUri, {
    compressionMethod: "manual",
    bitrate: config.compress.bitrate,
    maxSize: config.compress.maxSize,
  });
}
