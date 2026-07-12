/**
 * Voice-note recorder for the completion form (Module 3 "remarks: text OR audio").
 *
 * Uses **expo-av**, not expo-audio: expo-audio 0.3.5's recorder throws
 * `IllegalStateException` on `stop()` across this device regardless of config
 * (audio focus, explicit options, mono — all tried). expo-av is deprecated in
 * SDK 52 but is the mature, reliable recorder; migrate to a fixed expo-audio at
 * SDK 53.
 *
 * Records **AAC in an .m4a / MPEG-4 container** (HIGH_QUALITY preset) so the
 * manager web can play it back in a browser <audio> element. The clip uri is
 * handed up; CompleteJobScreen uploads it as a media row (type=audio, audio/mp4).
 */

import { Audio, type AVPlaybackStatus } from "expo-av";
import * as FileSystem from "expo-file-system";
import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";

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
  const recordingRef = useRef<Audio.Recording | null>(null);
  const startingRef = useRef(false);
  const soundRef = useRef<Audio.Sound | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);

  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [posMs, setPosMs] = useState(0);
  const [durMs, setDurMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const clearTimer = () => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  };

  const onStatus = (s: AVPlaybackStatus) => {
    if (!s.isLoaded || !mounted.current) return;
    setPlaying(s.isPlaying);
    setPosMs(s.positionMillis);
    setDurMs(s.durationMillis ?? 0);
    if (s.didJustFinish) setPlaying(false);
  };

  const stop = async () => {
    const rec = recordingRef.current;
    if (!rec) return;
    recordingRef.current = null;
    clearTimer();
    setBusy(true);
    try {
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const out = rec.getURI();
      if (!out) {
        if (mounted.current) setError("Recording failed — please try again.");
      } else {
        // Guard against a 0-byte cache anomaly before we hand the clip up.
        const info = await FileSystem.getInfoAsync(out, { size: true });
        const ok = info.exists && (!("size" in info) || info.size > 0);
        if (mounted.current) {
          if (ok) onChange(out);
          else setError("Recording was empty — please try again.");
        }
      }
    } catch (e) {
      if (mounted.current) {
        setError(`Couldn't stop recording: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      if (mounted.current) {
        setRecording(false);
        setBusy(false);
      }
    }
  };

  const start = async () => {
    // Guard a double-tap: a second start while one is preparing would fail
    // and its catch used to orphan the FIRST recording (mic held forever).
    if (startingRef.current || recordingRef.current) return;
    startingRef.current = true;
    setError(null);
    let rec: Audio.Recording | null = null;
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        setError("Microphone permission needed — enable it in Settings.");
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      recordingRef.current = rec;
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
    } catch (e) {
      // Unload the half-started session — never leave it holding the mic.
      await rec?.stopAndUnloadAsync().catch(() => {});
      clearTimer();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      if (mounted.current) {
        setRecording(false);
        setError(`Couldn't start recording: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      startingRef.current = false;
    }
  };

  const togglePlay = async () => {
    const sound = soundRef.current;
    if (!sound) return;
    try {
      if (playing) {
        await sound.pauseAsync();
      } else {
        if (durMs > 0 && posMs >= durMs) await sound.setPositionAsync(0);
        await sound.playAsync();
      }
    } catch {
      if (mounted.current) setError("Couldn't play the recording.");
    }
  };

  // Preload the recorded clip so its duration shows and play/pause is instant;
  // unload when the clip changes or is deleted.
  useEffect(() => {
    if (!uri) return undefined;
    let active = true;
    let local: Audio.Sound | null = null;
    void (async () => {
      try {
        const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: false }, onStatus);
        if (!active) {
          await sound.unloadAsync().catch(() => {});
          return;
        }
        local = sound;
        soundRef.current = sound;
      } catch {
        /* leave the player unavailable; recording still works */
      }
    })();
    return () => {
      active = false;
      void local?.unloadAsync().catch(() => {});
      soundRef.current = null;
      setPlaying(false);
      setPosMs(0);
      setDurMs(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  // Cleanup on unmount; auto-stop a recording if the app leaves the foreground.
  useEffect(() => {
    mounted.current = true;
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active" && recordingRef.current) void stop();
    });
    return () => {
      mounted.current = false;
      clearTimer();
      sub.remove();
      void recordingRef.current?.stopAndUnloadAsync().catch(() => {});
      void soundRef.current?.unloadAsync().catch(() => {});
      void Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.box}>
      {error ? <Text style={styles.err}>{error}</Text> : null}
      {uri ? (
        <View style={styles.row}>
          <Pressable style={styles.play} onPress={() => void togglePlay()}>
            <Text style={styles.playText}>{playing ? "❚❚ Pause" : "▶ Play"}</Text>
          </Pressable>
          <View style={styles.grow}>
            <Text style={styles.ok}>Voice note recorded</Text>
            <Text style={styles.dur}>
              {fmt(posMs)} / {fmt(durMs)}
            </Text>
          </View>
          <Pressable
            style={styles.ghost}
            onPress={() => {
              void soundRef.current?.pauseAsync().catch(() => {});
              onChange(null);
            }}
          >
            <Text style={styles.del}>Delete</Text>
          </Pressable>
        </View>
      ) : recording ? (
        <Pressable style={styles.stop} onPress={() => void stop()} disabled={busy}>
          <Text style={styles.stopText}>{busy ? "Saving…" : `■ Stop · ${fmt(elapsedMs)}`}</Text>
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
  play: { backgroundColor: "#0f172a", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
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
