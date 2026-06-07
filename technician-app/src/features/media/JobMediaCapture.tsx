/**
 * Before/After capture for one job, keyed on `jobKey`. Reused by both the
 * standalone Media tab (free-text job id) and the Job Detail screen (bound to
 * the job's token, so no typing — and the manager web gallery, which reads
 * `GET /api/jobs/{token}/media`, sees the same media).
 *
 * Owns the camera-launch + the Before/After columns; the upload pipeline and
 * list state live in `useMedia` / `uploadMedia`, unchanged.
 */

import * as ImagePicker from "expo-image-picker";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

import type { MediaType, Phase } from "../../lib/api";
import { MediaTile } from "./MediaTile";
import { useMedia } from "./useMedia";

// This component only handles the before/after evidence columns (remark/closing
// media are uploaded elsewhere). Narrow to those two keys of MediaList.
const PHASES = ["before", "after"] as const;

export function JobMediaCapture({ jobKey }: { jobKey: string }) {
  const media = useMedia(jobKey);

  const capture = async (phase: Phase, type: MediaType) => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Camera permission needed", "Enable camera access for FixFlow in Settings.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes:
        type === "video" ? ImagePicker.MediaTypeOptions.Videos : ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      videoMaxDuration: 60,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    if (!asset) return;
    await media.upload({
      phase,
      type,
      uri: asset.uri,
      filename: asset.fileName ?? `${type}-${Date.now()}.${type === "video" ? "mp4" : "jpg"}`,
      contentType: asset.mimeType ?? (type === "video" ? "video/mp4" : "image/jpeg"),
    });
  };

  const askRemove = (id: string) =>
    Alert.alert("Remove media?", "This deletes the file from storage.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          void media.remove(id);
        },
      },
    ]);

  return (
    <View>
      {media.error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{media.error}</Text>
        </View>
      ) : null}

      {PHASES.map((phase) => {
        const items = media.list[phase];
        const isUploading = media.uploadingPhase === phase;
        const title = phase === "before" ? "Before" : "After";
        return (
          <View key={phase} style={styles.section}>
            <Text style={styles.sectionTitle}>{title}</Text>
            <View style={styles.tiles}>
              {items.map((m) => (
                <MediaTile key={m.id} item={m} onDelete={() => askRemove(m.id)} />
              ))}
              {items.length === 0 ? <Text style={styles.empty}>No {phase} media yet</Text> : null}
            </View>
            <View style={styles.buttons}>
              <Pressable
                style={[styles.btn, styles.btnPrimary, isUploading && styles.btnDisabled]}
                onPress={() => {
                  void capture(phase, "video");
                }}
                disabled={isUploading}
              >
                <Text style={styles.btnText}>Record video</Text>
              </Pressable>
              <Pressable
                style={[styles.btn, styles.btnSecondary, isUploading && styles.btnDisabled]}
                onPress={() => {
                  void capture(phase, "photo");
                }}
                disabled={isUploading}
              >
                <Text style={[styles.btnText, styles.btnSecondaryText]}>Photo</Text>
              </Pressable>
            </View>
            {isUploading ? (
              <View style={styles.uploading}>
                <ActivityIndicator />
                <Text style={styles.uploadingText}>Uploading…</Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: "#0f172a", marginBottom: 12 },
  tiles: { flexDirection: "row", flexWrap: "wrap" },
  empty: { color: "#94a3b8", fontStyle: "italic", fontSize: 13, padding: 8 },
  buttons: { flexDirection: "row", gap: 8, marginTop: 8 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  btnPrimary: { backgroundColor: "#0f172a" },
  btnSecondary: { backgroundColor: "white", borderWidth: 1, borderColor: "#cbd5e1" },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: "white", fontWeight: "700", fontSize: 15 },
  btnSecondaryText: { color: "#475569" },
  uploading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
  },
  uploadingText: { color: "#475569", fontWeight: "600" },
  errorBox: { backgroundColor: "#fee2e2", borderRadius: 8, padding: 12, marginBottom: 12 },
  errorText: { color: "#b91c1c", fontSize: 13 },
});
