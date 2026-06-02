/**
 * The single screen of the technician demo.
 *
 * Renders a Job ID input + a Before column and an After column, each with
 * Record-video / Photo buttons. The job ID input lets the demo drive any job
 * created in the manager web app — no real auth needed for this slice.
 */

import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { MediaType, Phase } from "../../lib/api";
import { MediaTile } from "./MediaTile";
import { useMedia } from "./useMedia";

const DEFAULT_JOB = "demo-job";
const PHASES: readonly Phase[] = ["before", "after"];

export function MediaScreen() {
  const [jobId, setJobId] = useState(DEFAULT_JOB);
  const media = useMedia(jobId);

  const capture = async (phase: Phase, type: MediaType) => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Camera permission needed",
        "Enable camera access for FixFlow in Settings.",
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes:
        type === "video"
          ? ImagePicker.MediaTypeOptions.Videos
          : ImagePicker.MediaTypeOptions.Images,
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
      filename:
        asset.fileName ??
        `${type}-${Date.now()}.${type === "video" ? "mp4" : "jpg"}`,
      contentType:
        asset.mimeType ?? (type === "video" ? "video/mp4" : "image/jpeg"),
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
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.h1}>FixFlow · Technician</Text>
      <Text style={styles.h2}>Before / After capture</Text>

      <View style={styles.jobBox}>
        <Text style={styles.label}>Job ID</Text>
        <TextInput
          style={styles.input}
          value={jobId}
          onChangeText={setJobId}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="demo-job"
        />
      </View>

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
                <MediaTile
                  key={m.id}
                  item={m}
                  onDelete={() => askRemove(m.id)}
                />
              ))}
              {items.length === 0 ? (
                <Text style={styles.empty}>No {phase} media yet</Text>
              ) : null}
            </View>
            <View style={styles.buttons}>
              <Pressable
                style={[
                  styles.btn,
                  styles.btnPrimary,
                  isUploading && styles.btnDisabled,
                ]}
                onPress={() => {
                  void capture(phase, "video");
                }}
                disabled={isUploading}
              >
                <Text style={styles.btnText}>Record video</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.btn,
                  styles.btnSecondary,
                  isUploading && styles.btnDisabled,
                ]}
                onPress={() => {
                  void capture(phase, "photo");
                }}
                disabled={isUploading}
              >
                <Text style={[styles.btnText, styles.btnSecondaryText]}>
                  Photo
                </Text>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingTop: 48,
    paddingBottom: 64,
    backgroundColor: "#f8fafc",
    flexGrow: 1,
  },
  h1: { fontSize: 22, fontWeight: "800", color: "#0f172a" },
  h2: { fontSize: 14, fontWeight: "600", color: "#475569", marginTop: 2 },
  jobBox: { marginTop: 16, marginBottom: 16 },
  label: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748b",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  input: {
    backgroundColor: "white",
    borderColor: "#cbd5e1",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  section: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 12,
  },
  tiles: { flexDirection: "row", flexWrap: "wrap" },
  empty: { color: "#94a3b8", fontStyle: "italic", fontSize: 13, padding: 8 },
  buttons: { flexDirection: "row", gap: 8, marginTop: 8 },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  btnPrimary: { backgroundColor: "#0f172a" },
  btnSecondary: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#cbd5e1",
  },
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
  errorBox: {
    backgroundColor: "#fee2e2",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  errorText: { color: "#b91c1c", fontSize: 13 },
});
