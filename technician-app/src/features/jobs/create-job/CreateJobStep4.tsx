import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, Pressable, TextInput, Switch, ScrollView, AppState } from 'react-native';
import { Audio, type AVPlaybackStatus } from "expo-av";
import * as FileSystem from "expo-file-system";

// ------------------------------------------------------------------
// 🎙️ THE EXACT VOICE NOTE COMPONENT FROM YOUR COMPLETION SCREEN
// ------------------------------------------------------------------

const MAX_MS = 120_000;
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
    setError(null);
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        setError("Microphone permission needed — enable it in Settings.");
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const rec = new Audio.Recording();
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
      recordingRef.current = null;
      clearTimer();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      if (mounted.current) {
        setRecording(false);
        setError(`Couldn't start recording: ${e instanceof Error ? e.message : String(e)}`);
      }
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
  }, [uri]);

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
  }, []);

  return (
    <View style={vnStyles.box}>
      {error ? <Text style={vnStyles.err}>{error}</Text> : null}
      {uri ? (
        <View style={vnStyles.row}>
          <Pressable style={vnStyles.play} onPress={() => void togglePlay()}>
            <Text style={vnStyles.playText}>{playing ? "❚❚ Pause" : "▶ Play"}</Text>
          </Pressable>
          <View style={vnStyles.grow}>
            <Text style={vnStyles.ok}>Voice note recorded</Text>
            <Text style={vnStyles.dur}>
              {fmt(posMs)} / {fmt(durMs)}
            </Text>
          </View>
          <Pressable
            style={vnStyles.ghost}
            onPress={() => {
              void soundRef.current?.pauseAsync().catch(() => {});
              onChange(null);
            }}
          >
            <Text style={vnStyles.del}>Delete</Text>
          </Pressable>
        </View>
      ) : recording ? (
        <Pressable style={vnStyles.stop} onPress={() => void stop()} disabled={busy}>
          <Text style={vnStyles.stopText}>{busy ? "Saving…" : `■ Stop · ${fmt(elapsedMs)}`}</Text>
        </Pressable>
      ) : (
        <Pressable style={vnStyles.rec} onPress={() => void start()}>
          <Text style={vnStyles.recText}>● Record voice note</Text>
        </Pressable>
      )}
    </View>
  );
}

// ------------------------------------------------------------------
// 📄 STEP 4 SCREEN
// ------------------------------------------------------------------

interface Step4Props {
  estimate: string;
  setEstimate: (val: string) => void;
  approval: string;
  setApproval: (val: string) => void;
  consent: boolean;
  setConsent: (val: boolean) => void;
  voiceNote: string;
  setVoiceNote: (val: string) => void;
  name: string;
  appliance: string;
  brand: string;
  serviceType: string;
  timeWindow: string;
  onSubmit: () => void;
}

export function CreateJobStep4({ 
  estimate, setEstimate, 
  approval, setApproval, 
  consent, setConsent, 
  voiceNote, setVoiceNote,
  name, appliance, brand, serviceType, timeWindow,
  onSubmit 
}: Step4Props) {
  
  const isStep4Valid = estimate.trim().length > 0;

  return (
    <ScrollView style={styles.stepContainer} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>Estimate & Approval</Text>

      {/* 💰 1. ESTIMATE AMOUNT */}
      <Text style={styles.sectionHeader}>Initial Quote</Text>
      <View style={styles.priceInputContainer}>
        <Text style={styles.currency}>Rs.</Text>
        <TextInput
          style={styles.priceInput}
          placeholder="0.00"
          placeholderTextColor="#94a3b8"
          keyboardType="numeric"
          value={estimate}
          onChangeText={setEstimate}
        />
      </View>

      {/* 🎙️ 2. THE PRODUCTION VOICE NOTE ATTACHMENT */}
      <Text style={styles.sectionHeader}>Estimate Justification (Optional)</Text>
      <View style={styles.voiceNoteWrapper}>
        <VoiceNote 
          uri={voiceNote ? voiceNote : null} 
          onChange={(uri) => setVoiceNote(uri || '')} 
        />
      </View>

      <View style={styles.divider} />

      {/* ✅ 3. APPROVAL STATUS */}
      <Text style={styles.sectionHeader}>Approval Status</Text>
      <View style={styles.chipRow}>
        {['Approve now', 'Customer review', 'Pending'].map((item) => (
          <Pressable 
            key={item} 
            style={[styles.chip, approval === item && styles.chipActive]}
            onPress={() => setApproval(item)}
          >
            <Text style={[styles.chipText, approval === item && styles.chipTextActive]}>{item}</Text>
          </Pressable>
        ))}
      </View>

      {/* 📝 4. CONSENT TOGGLE */}
      <View style={styles.consentRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.consentTitle}>Customer Consent</Text>
          <Text style={styles.consentSubtitle}>Customer agrees to the service terms</Text>
        </View>
        <Switch 
          value={consent} 
          onValueChange={setConsent} 
          trackColor={{ false: '#cbd5e1', true: '#10b981' }}
          thumbColor="#ffffff"
        />
      </View>

      <View style={{ height: 40 }} />

      {/* 🚀 SUBMIT BUTTON */}
      <Pressable 
        style={[styles.submitBtn, !isStep4Valid && styles.submitBtnDisabled]}
        disabled={!isStep4Valid}
        onPress={onSubmit}
      >
        <Text style={styles.submitBtnText}>Create Task</Text>
      </Pressable>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// Styles for your VoiceNote Component
const vnStyles = StyleSheet.create({
  box: { marginTop: 0 }, // Removed top margin so it sits flush in the new container
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  grow: { flex: 1 },
  err: { color: "#b91c1c", fontSize: 12, fontWeight: "600", marginBottom: 6 },
  ok: { color: "#059669", fontWeight: "700", fontSize: 13 },
  dur: { color: "#64748b", fontSize: 12, marginTop: 1, fontVariant: ["tabular-nums"] },
  rec: { backgroundColor: "white", borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  recText: { color: "#b91c1c", fontWeight: "800", fontSize: 14 },
  stop: { backgroundColor: "#b91c1c", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  stopText: { color: "white", fontWeight: "800", fontSize: 14, fontVariant: ["tabular-nums"] },
  play: { backgroundColor: "#0f172a", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  playText: { color: "white", fontWeight: "800", fontSize: 13 },
  ghost: { borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  del: { color: "#b91c1c", fontWeight: "700", fontSize: 13 },
});

// Styles for Step 4
const styles = StyleSheet.create({
  stepContainer: { flex: 1, paddingTop: 20 },
  title: { fontSize: 28, fontWeight: '800', fontStyle: 'italic', color: '#0f172a', marginBottom: 24 },
  sectionHeader: { fontSize: 13, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginBottom: 12, letterSpacing: 0.5 },
  
  priceInputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#94a3b8', borderRadius: 12, paddingHorizontal: 16, marginBottom: 24 },
  currency: { fontSize: 20, fontWeight: '600', color: '#64748b', marginRight: 8 },
  priceInput: { flex: 1, height: 64, fontSize: 24, fontWeight: '700', color: '#0f172a' },

  voiceNoteWrapper: { marginBottom: 24 },

  divider: { height: 1, backgroundColor: '#e2e8f0', marginBottom: 24 },

  chipRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  chip: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  chipActive: { backgroundColor: '#1c1917', borderColor: '#1c1917' },
  chipText: { color: '#475569', fontWeight: '600', fontSize: 14 },
  chipTextActive: { color: '#ffffff' },

  consentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#f8fafc', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  consentTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  consentSubtitle: { fontSize: 13, color: '#64748b', marginTop: 2 },

  submitBtn: { backgroundColor: '#10b981', paddingVertical: 18, borderRadius: 24, alignItems: 'center' },
  submitBtnDisabled: { backgroundColor: '#cbd5e1' },
  submitBtnText: { color: 'white', fontSize: 16, fontWeight: '800' },
});