/**
 * Selfie capture (front camera) for a punch. The captured file is copied out of
 * the volatile picker cache into `documentDirectory` so it survives until the
 * (possibly much later, offline) background upload. Returns null if the camera
 * is denied or the user cancels — the punch is still valid without a photo.
 */

import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";

export interface SelfieCapture {
  uri: string; // durable file:// path under documentDirectory
  filename: string;
  contentType: string;
}

const DIR = `${FileSystem.documentDirectory}attendance`;

export async function captureSelfie(): Promise<SelfieCapture | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    cameraType: ImagePicker.CameraType.front,
    quality: 0.6,
    allowsEditing: false,
  });
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0];
  if (!asset) return null;

  const filename = asset.fileName ?? `selfie-${Date.now()}.jpg`;
  const dest = `${DIR}/${Date.now()}-${filename}`;
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => undefined);
  await FileSystem.copyAsync({ from: asset.uri, to: dest });

  return {
    uri: dest,
    filename,
    contentType: asset.mimeType ?? "image/jpeg",
  };
}
