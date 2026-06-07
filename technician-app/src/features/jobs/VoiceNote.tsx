/**
 * Voice-note recorder for the completion form (Module 3 "remarks: text OR
 * audio"). Records via expo-audio and hands the local file uri up; the
 * CompleteJobScreen uploads it as a media row (type=audio) and links its id.
 */

import { AudioModule, RecordingPresets, useAudioPlayer, useAudioRecorder } from "expo-audio";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export function VoiceNote({
  uri,
  onChange,
}: {
  uri: string | null;
  onChange: (uri: string | null) => void;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY!);
  const player = useAudioPlayer(uri ?? undefined);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setError(null);
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError("Microphone permission needed.");
        return;
      }
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch {
      setError("Couldn't start recording.");
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await recorder.stop();
      onChange(recorder.uri ?? null);
    } catch {
      setError("Couldn't stop recording.");
    } finally {
      setRecording(false);
      setBusy(false);
    }
  };

  return (
    <View style={styles.box}>
      {error ? <Text style={styles.err}>{error}</Text> : null}
      {uri ? (
        <View style={styles.row}>
          <Pressable style={styles.ghost} onPress={() => player.play()}>
            <Text style={styles.ghostText}>▶ Play</Text>
          </Pressable>
          <Text style={styles.ok}>Voice note recorded</Text>
          <Pressable style={styles.ghost} onPress={() => onChange(null)}>
            <Text style={styles.del}>Delete</Text>
          </Pressable>
        </View>
      ) : recording ? (
        <Pressable style={styles.stop} onPress={() => void stop()} disabled={busy}>
          <Text style={styles.stopText}>{busy ? "…" : "■ Stop recording"}</Text>
        </Pressable>
      ) : (
        <Pressable style={styles.rec} onPress={() => void start()}>
          <Text style={styles.recText}>● Record voice note</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  err: { color: "#b91c1c", fontSize: 12, fontWeight: "600", marginBottom: 6 },
  ok: { flex: 1, color: "#059669", fontWeight: "700", fontSize: 13 },
  rec: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  recText: { color: "#b91c1c", fontWeight: "800", fontSize: 14 },
  stop: { backgroundColor: "#b91c1c", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  stopText: { color: "white", fontWeight: "800", fontSize: 14 },
  ghost: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  ghostText: { color: "#0f172a", fontWeight: "700", fontSize: 13 },
  del: { color: "#b91c1c", fontWeight: "700", fontSize: 13 },
});
