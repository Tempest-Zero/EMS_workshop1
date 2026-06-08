/**
 * Voice-note recorder for the completion form (Module 3 "remarks: text OR
 * audio"). Records via expo-audio (SDK 52) and hands the local file uri up;
 * CompleteJobScreen uploads it as a media row (type=audio) and links its id.
 *
 * Records **AAC in an .m4a / MPEG-4 container** on purpose: the manager web plays
 * the clip back in a desktop browser <audio> element, and the platform defaults
 * (Android 3GP/AMR, iOS CAF/PCM) don't play in browsers.
 *
 * Reliability notes for expo-audio 0.3.x on Android:
 *  - `setAudioModeAsync({ allowsRecording: true })` is called BEFORE recording to
 *    acquire Android audio focus. Without it the native recorder never leaves the
 *    "initial" state and `stop()` throws — the "couldn't stop recording" bug.
 *  - The elapsed-time counter is a plain JS interval (a `useRef`), not
 *    `useAudioRecorderState`, whose 2 Hz native polling can race with `stop()`.
 *  - A mounted sentinel + cleanup release the mic / audio focus and clear timers
 *    on unmount or app-background, so the OS mic never stays locked.
 */

import {
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  type RecordingOptions,
} from "expo-audio";
import * as FileSystem from "expo-file-system";
import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";

// AAC-LC in an MPEG-4 (.m4a) container — universally decodable by Chromium,
// WebKit and Firefox, so the manager-web <audio> player can play it.
const M4A_OPTIONS: RecordingOptions = {
  extension: ".m4a",
  sampleRate: 44100,
  numberOfChannels: 2,
  bitRate: 128000,
  android: { outputFormat: "mpeg4", audioEncoder: "aac" },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MAX,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: "audio/mp4", bitsPerSecond: 128000 },
};

const MAX_MS = 120_000; // safety cap — auto-stop a runaway recording at 2 minutes
const TICK_MS = 200;

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function VoiceNote({
  uri,
  onChange,
}: {
  uri: string | null;
  onChange: (uri: string | null) => void;
}) {
  const recorder = useAudioRecorder(M4A_OPTIONS);
  const player = useAudioPlayer(uri ?? undefined);
  const status = useAudioPlayerStatus(player);

  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mounted = useRef(true);
  const recordingRef = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = () => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  };

  const stop = async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    clearTimer();
    setBusy(true);
    try {
      await recorder.stop();
      const out = recorder.uri;
      if (!out) {
        if (mounted.current) setError("Recording failed — please try again.");
      } else {
        // Android can leave a 0-byte cache file under memory pressure — verify it.
        const info = await FileSystem.getInfoAsync(out, { size: true });
        const ok = info.exists && (!("size" in info) || info.size > 0);
        if (mounted.current) {
          if (ok) onChange(out);
          else setError("Recording was empty — please try again.");
        }
      }
    } catch {
      if (mounted.current) setError("Couldn't stop recording — try again.");
    } finally {
      // Release audio focus so background audio resumes and the mic isn't held.
      await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      if (mounted.current) {
        setRecording(false);
        setBusy(false);
      }
    }
  };

  const start = async () => {
    setError(null);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError("Microphone permission needed — enable it in Settings.");
        return;
      }
      // Acquire audio focus BEFORE preparing — the fix for stop() throwing.
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordingRef.current = true;
      setRecording(true);
      setElapsedMs(0);
      clearTimer();
      timer.current = setInterval(() => {
        if (!mounted.current) return;
        setElapsedMs((prev) => {
          const next = prev + TICK_MS;
          if (next >= MAX_MS) void stop();
          return next;
        });
      }, TICK_MS);
    } catch {
      recordingRef.current = false;
      clearTimer();
      await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      if (mounted.current) {
        setRecording(false);
        setError("Couldn't start recording — try again.");
      }
    }
  };

  const togglePlay = () => {
    if (status.playing) {
      player.pause();
    } else {
      if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) {
        void player.seekTo(0);
      }
      player.play();
    }
  };

  // Release the mic + clear timers on unmount; auto-stop if the app backgrounds.
  useEffect(() => {
    mounted.current = true;
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active" && recordingRef.current) {
        recordingRef.current = false;
        clearTimer();
        recorder.stop().catch(() => {});
        void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
        if (mounted.current) {
          setRecording(false);
          setBusy(false);
        }
      }
    });
    return () => {
      mounted.current = false;
      clearTimer();
      sub.remove();
      if (recordingRef.current) recorder.stop().catch(() => {});
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    };
  }, [recorder]);

  return (
    <View style={styles.box}>
      {error ? <Text style={styles.err}>{error}</Text> : null}
      {uri ? (
        <View style={styles.row}>
          <Pressable style={styles.play} onPress={togglePlay}>
            <Text style={styles.playText}>{status.playing ? "❚❚ Pause" : "▶ Play"}</Text>
          </Pressable>
          <View style={styles.grow}>
            <Text style={styles.ok}>Voice note recorded</Text>
            <Text style={styles.dur}>
              {fmt(status.currentTime * 1000)} / {fmt(status.duration * 1000)}
            </Text>
          </View>
          <Pressable
            style={styles.ghost}
            onPress={() => {
              if (status.playing) player.pause();
              onChange(null);
            }}
          >
            <Text style={styles.del}>Delete</Text>
          </Pressable>
        </View>
      ) : recording ? (
        <Pressable style={styles.stop} onPress={() => void stop()} disabled={busy}>
          <Text style={styles.stopText}>
            {busy ? "Saving…" : `■ Stop · ${fmt(elapsedMs)}`}
          </Text>
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
  grow: { flex: 1 },
  err: { color: "#b91c1c", fontSize: 12, fontWeight: "600", marginBottom: 6 },
  ok: { color: "#059669", fontWeight: "700", fontSize: 13 },
  dur: { color: "#64748b", fontSize: 12, marginTop: 1, fontVariant: ["tabular-nums"] },
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
  stopText: { color: "white", fontWeight: "800", fontSize: 14, fontVariant: ["tabular-nums"] },
  play: {
    backgroundColor: "#0f172a",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  playText: { color: "white", fontWeight: "800", fontSize: 13 },
  ghost: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  del: { color: "#b91c1c", fontWeight: "700", fontSize: 13 },
});
