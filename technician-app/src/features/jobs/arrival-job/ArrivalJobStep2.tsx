import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, Pressable, SafeAreaView, AppState, Platform } from 'react-native';
import { Audio, type AVPlaybackStatus } from "expo-av";
import * as FileSystem from "expo-file-system";
import { Ionicons } from '@expo/vector-icons';

const MAX_MS = 120_000;
const TICK_MS = 200;
/** A tap shorter than this can't hold a usable summary — discard it. */
const MIN_MS = 1_000;

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

interface Step2Props {
  /** The recorded work-summary URI — owned by the wizard's persisted draft. */
  voiceUri: string | null;
  /** Fires once per finished recording; the wizard uploads it (phase remark). */
  onRecorded: (uri: string) => void;
  onDeleted: () => void;
  onNext: () => void;
}

export function ArrivalJobStep2({ voiceUri, onRecorded, onDeleted, onNext }: Step2Props) {

  // Audio Recorder State. The press drives two async sequences (start on
  // press-in, stop on press-out) that can overlap on a quick tap — the refs
  // below serialize them so a recording is never left running unheld and the
  // live Recording object is never orphaned while it still holds the mic.
  const recordingRef = useRef<Audio.Recording | null>(null);
  const startingRef = useRef(false);
  const pressActive = useRef(false);
  const soundRef = useRef<Audio.Sound | null>(null);
  const mounted = useRef(true);

  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [posMs, setPosMs] = useState(0);
  const [durMs, setDurMs] = useState(0);

  const onStatus = (s: AVPlaybackStatus) => {
    if (!s.isLoaded || !mounted.current) return;
    setPlaying(s.isPlaying);
    setPosMs(s.positionMillis);
    setDurMs(s.durationMillis ?? 0);
    if (s.didJustFinish) setPlaying(false);
  };

  // The timer reads the recorder's own clock (not a hand-accumulated
  // interval), so the display can't drift from the file's real duration.
  const onRecStatus = (s: Audio.RecordingStatus) => {
    if (!mounted.current || !s.isRecording) return;
    setElapsedMs(s.durationMillis);
    if (s.durationMillis >= MAX_MS) void stopRecording();
  };

  const startRecording = async () => {
    if (busy || startingRef.current || recordingRef.current) return;
    startingRef.current = true;
    let rec: Audio.Recording | null = null;
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) return;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      rec = new Audio.Recording();
      rec.setOnRecordingStatusUpdate(onRecStatus);
      rec.setProgressUpdateInterval(TICK_MS);
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      recordingRef.current = rec;
      if (mounted.current) {
        setElapsedMs(0);
        setHint(null);
        setRecording(true);
      }
    } catch {
      // Unload whatever was acquired — a half-started session left behind
      // keeps the mic and blocks every future recording.
      await rec?.stopAndUnloadAsync().catch(() => {});
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      if (mounted.current) setRecording(false);
    } finally {
      startingRef.current = false;
    }
    // The press may have ended while we were still preparing — close the
    // session instead of leaving it recording with no finger on the button.
    if (recordingRef.current && (!pressActive.current || !mounted.current)) {
      void stopRecording();
    }
  };

  const stopRecording = async () => {
    // A quick tap releases before the start sequence assigns the ref — wait
    // (bounded) so the stop always has the session to close.
    for (let i = 0; startingRef.current && i < 80; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const rec = recordingRef.current;
    if (!rec) return;
    recordingRef.current = null;
    setBusy(true);
    try {
      const status = await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const out = rec.getURI();
      if (out) {
        if (status.durationMillis < MIN_MS) {
          // Too short to be a summary — a stray tap, not a recording.
          await FileSystem.deleteAsync(out, { idempotent: true }).catch(() => {});
          if (mounted.current) setHint("Too short — press and hold while you speak.");
        } else {
          const info = await FileSystem.getInfoAsync(out, { size: true });
          const ok = info.exists && (!("size" in info) || info.size > 0);
          if (mounted.current && ok) onRecorded(out);
        }
      }
    } catch {
      // stopAndUnloadAsync released the session either way; nothing to keep.
    } finally {
      if (mounted.current) {
        setRecording(false);
        setBusy(false);
        setElapsedMs(0);
      }
    }
  };

  const togglePlay = async () => {
    const sound = soundRef.current;
    if (!sound) return;
    try {
      if (playing) await sound.pauseAsync();
      else {
        if (durMs > 0 && posMs >= durMs) await sound.setPositionAsync(0);
        await sound.playAsync();
      }
    } catch {}
  };

  const deleteRecording = () => {
    void soundRef.current?.pauseAsync().catch(() => {});
    setElapsedMs(0);
    setHint(null);
    onDeleted();
  };

  // Lifecycle management for the audio player
  useEffect(() => {
    if (!voiceUri) return undefined;
    let active = true;
    let local: Audio.Sound | null = null;
    void (async () => {
      try {
        const { sound } = await Audio.Sound.createAsync({ uri: voiceUri }, { shouldPlay: false }, onStatus);
        if (!active) { await sound.unloadAsync().catch(() => {}); return; }
        local = sound;
        soundRef.current = sound;
      } catch {}
    })();
    return () => {
      active = false;
      void local?.unloadAsync().catch(() => {});
      soundRef.current = null;
      setPlaying(false); setPosMs(0); setDurMs(0);
    };
  }, [voiceUri]);

  useEffect(() => {
    mounted.current = true;
    const sub = AppState.addEventListener("change", (next) => { if (next !== "active" && recordingRef.current) void stopRecording(); });
    return () => {
      mounted.current = false; sub.remove();
      void recordingRef.current?.stopAndUnloadAsync().catch(() => {});
      void soundRef.current?.unloadAsync().catch(() => {});
      void Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
    };
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      {/* 🟢 HEADER */}
      <View style={styles.header}>
        <View style={styles.stepBadge}>
          <Text style={styles.stepBadgeText}>2 / 5</Text>
        </View>
      </View>

      {/* 🎙️ CENTER CONTENT */}
      <View style={styles.centerContent}>
        <Text style={styles.title}>Voice summary</Text>
        <Text style={styles.subtitle}>"say what you found and what you did"</Text>

        {!voiceUri ? (
          <View style={styles.micWrapper}>
            <Pressable
              style={[styles.hugeMicButton, recording && styles.hugeMicButtonActive]}
              onPressIn={() => {
                pressActive.current = true;
                void startRecording();
              }}
              onPressOut={() => {
                pressActive.current = false;
                void stopRecording();
              }}
              disabled={busy}
            >
              <Ionicons 
                name={recording ? "mic" : "mic-outline"} 
                size={80} 
                color="#ffffff" 
              />
            </Pressable>
            
            {/* Audio Waveform Mockup */}
            <View style={styles.waveformMock}>
              {[1, 2, 3, 4, 3, 2, 1].map((bar, i) => (
                <View 
                  key={i} 
                  style={[
                    styles.waveBar, 
                    { height: recording ? bar * 12 : bar * 4, opacity: recording ? 1 : 0.3 }
                  ]} 
                />
              ))}
            </View>

            <Text style={[styles.helperText, recording && styles.helperTextActive]}>
              {busy
                ? "Saving..."
                : recording
                  ? `Recording (${fmt(elapsedMs)})`
                  : (hint ?? "saved as audio - transcribe when cheap")}
            </Text>
          </View>
        ) : (
          <View style={styles.playbackWrapper}>
            <View style={styles.audioPlayer}>
              <Pressable style={styles.playBtn} onPress={() => void togglePlay()}>
                <Ionicons name={playing ? "pause" : "play"} size={24} color="#ffffff" />
              </Pressable>
              <View style={styles.audioDetails}>
                <Text style={styles.audioTitle}>Summary Recorded</Text>
                <Text style={styles.audioTime}>{fmt(posMs)} / {fmt(durMs)}</Text>
              </View>
              <Pressable style={styles.deleteBtn} onPress={deleteRecording}>
                <Ionicons name="trash-outline" size={20} color="#ef4444" />
              </Pressable>
            </View>
            <Text style={styles.helperText}>Audio saved and attached to job.</Text>
          </View>
        )}
      </View>

      {/* 🚀 STICKY FOOTER NAVIGATION */}
      <View style={styles.stickyFooter}>
        <Pressable 
          style={[styles.nextBtn, !voiceUri && styles.nextBtnDisabled]}
          disabled={!voiceUri}
          onPress={onNext}
        >
          <Text style={styles.nextBtnText}>Done</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  
  header: { alignItems: 'flex-end', paddingHorizontal: 24, paddingTop: Platform.OS === 'android' ? 40 : 20 },
  stepBadge: { backgroundColor: '#eff6ff', paddingVertical: 6, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: '#bfdbfe' },
  stepBadgeText: { color: '#2563eb', fontWeight: '800', fontSize: 14, fontVariant: ['tabular-nums'] },

  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, marginTop: -40 },
  title: { fontSize: 32, fontWeight: '800', fontStyle: 'italic', color: '#0f172a', marginBottom: 12 },
  subtitle: { fontSize: 16, color: '#64748b', fontWeight: '500', marginBottom: 60, fontStyle: 'italic' },

  micWrapper: { alignItems: 'center' },
  hugeMicButton: { 
    backgroundColor: '#3b82f6', 
    width: 180, 
    height: 180, 
    borderRadius: 90, 
    justifyContent: 'center', 
    alignItems: 'center',
    shadowColor: '#3b82f6', 
    shadowOpacity: 0.4, 
    shadowRadius: 20, 
    shadowOffset: { width: 0, height: 10 }, 
    elevation: 10 
  },
  hugeMicButtonActive: { 
    backgroundColor: '#ef4444', 
    shadowColor: '#ef4444',
    transform: [{ scale: 1.05 }] 
  },
  
  waveformMock: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 40, height: 40 },
  waveBar: { width: 4, backgroundColor: '#3b82f6', borderRadius: 2 },
  
  helperText: { marginTop: 16, fontSize: 14, color: '#94a3b8', fontWeight: '500' },
  helperTextActive: { color: '#ef4444', fontWeight: '700' },

  playbackWrapper: { width: '100%', alignItems: 'center', marginTop: 20 },
  audioPlayer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 20, padding: 16, width: '100%', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  playBtn: { backgroundColor: '#0f172a', width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  audioDetails: { flex: 1 },
  audioTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  audioTime: { fontSize: 14, color: '#64748b', marginTop: 4, fontVariant: ['tabular-nums'] },
  deleteBtn: { padding: 12, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, backgroundColor: '#ffffff' },

  stickyFooter: { paddingVertical: 16, paddingHorizontal: 24, paddingBottom: Platform.OS === 'ios' ? 32 : 16, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  nextBtn: { backgroundColor: '#1c1917', paddingVertical: 18, borderRadius: 24, alignItems: 'center' },
  nextBtnDisabled: { backgroundColor: '#cbd5e1' },
  nextBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },
});