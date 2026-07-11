import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, Pressable, TextInput, ScrollView, AppState, KeyboardAvoidingView, Platform } from 'react-native';
import { Audio, type AVPlaybackStatus } from "expo-av";
import * as FileSystem from "expo-file-system";
import { Ionicons } from '@expo/vector-icons';

const APPLIANCES = ['Fridge', 'AC', 'Washing Machine', 'Microwave', 'Water Dispenser', 'Oven'];
const BRANDS = ['Dawlance', 'Haier', 'Pel', 'Samsung', 'LG', 'Kenwood', 'Gree', 'Orient', 'Other'];

// ------------------------------------------------------------------
// 🎙️ THE "HOLD-TO-RECORD" VOICE COMPONENT
// ------------------------------------------------------------------
const MAX_MS = 120_000;
const TICK_MS = 200;

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function HoldToRecordVoice({ uri, onChange }: { uri: string | null; onChange: (uri: string | null) => void }) {
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
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
  };

  const onStatus = (s: AVPlaybackStatus) => {
    if (!s.isLoaded || !mounted.current) return;
    setPlaying(s.isPlaying);
    setPosMs(s.positionMillis);
    setDurMs(s.durationMillis ?? 0);
    if (s.didJustFinish) setPlaying(false);
  };

  const start = async () => {
    setError(null);
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) { setError("Microphone permission needed."); return; }
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
      recordingRef.current = null; clearTimer();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      if (mounted.current) { setRecording(false); setError(`Error: ${e instanceof Error ? e.message : String(e)}`); }
    }
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
        if (mounted.current) setError("Recording failed.");
      } else {
        const info = await FileSystem.getInfoAsync(out, { size: true });
        const ok = info.exists && (!("size" in info) || info.size > 0);
        if (mounted.current) {
          if (ok) onChange(out);
          else setError("Recording was empty.");
        }
      }
    } catch (e) {
      if (mounted.current) setError(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (mounted.current) { setRecording(false); setBusy(false); }
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
  }, [uri]);

  useEffect(() => {
    mounted.current = true;
    const sub = AppState.addEventListener("change", (next) => { if (next !== "active" && recordingRef.current) void stop(); });
    return () => {
      mounted.current = false; clearTimer(); sub.remove();
      void recordingRef.current?.stopAndUnloadAsync().catch(() => {});
      void soundRef.current?.unloadAsync().catch(() => {});
      void Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
    };
  }, []);

  return (
    <View style={vnStyles.container}>
      {error ? <Text style={vnStyles.err}>{error}</Text> : null}
      
      {uri ? (
        <View style={vnStyles.audioPlayerMock}>
          <Pressable style={vnStyles.playBtn} onPress={() => void togglePlay()}>
            <Text style={vnStyles.playText}>{playing ? "❚❚" : "▶"}</Text>
          </Pressable>
          <View style={vnStyles.grow}>
            <Text style={vnStyles.ok}>Voice note recorded</Text>
            <Text style={vnStyles.dur}>{fmt(posMs)} / {fmt(durMs)}</Text>
          </View>
          <Pressable style={vnStyles.trashBtn} onPress={() => { void soundRef.current?.pauseAsync().catch(() => {}); onChange(null); }}>
            <Ionicons name="trash-outline" size={18} color="#ef4444" />
          </Pressable>
        </View>
      ) : (
        <View style={vnStyles.micWrapper}>
          <Pressable 
            style={[vnStyles.micButton, recording && vnStyles.micButtonActive]}
            onPressIn={() => void start()}
            onPressOut={() => void stop()}
            disabled={busy}
          >
            <Ionicons 
              name={recording ? "mic" : "mic-outline"} 
              size={56} 
              color="#ffffff" 
            />
          </Pressable>
          <Text style={[vnStyles.micHelper, recording && vnStyles.micHelperActive]}>
            {busy ? "Saving audio..." : recording ? `Recording... Release to save (${fmt(elapsedMs)})` : "Hold to explain the problem"}
          </Text>
        </View>
      )}
    </View>
  );
}

// ------------------------------------------------------------------
// 📄 STEP 2 SCREEN 
// ------------------------------------------------------------------

interface Step2Props {
  appliance: string;
  setAppliance: (val: string) => void;
  brand: string;
  setBrand: (val: string) => void;
  problemText: string;
  setProblemText: (val: string) => void;
  problemAudio: string;
  setProblemAudio: (val: string) => void;
  inputMode: 'voice' | 'text';
  setInputMode: (val: 'voice' | 'text') => void;
  isExisting: boolean | null;
  onNext: () => void;
}

export function CreateJobStep2({ 
  appliance, setAppliance, 
  brand, setBrand, 
  problemText, setProblemText, 
  problemAudio, setProblemAudio,
  inputMode, setInputMode,
  isExisting, onNext 
}: Step2Props) {
  
  const [showAllBrands, setShowAllBrands] = useState(false);
  const visibleBrands = showAllBrands ? BRANDS : BRANDS.slice(0, 5);

  const isStep2Valid = appliance !== '' && brand !== '' && (problemText.trim().length > 0 || problemAudio.length > 0);

  return (
    // 🪄 NEW: Wrapped the entire screen in a KeyboardAvoidingView
    <KeyboardAvoidingView 
      style={{ flex: 1 }} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* 🪄 NEW: Added keyboardShouldPersistTaps so tapping 'Next' works instantly while typing */}
      <ScrollView 
        style={styles.stepContainer} 
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>What's the issue?</Text>

        {/* 1. APPLIANCE SELECTION */}
        <Text style={styles.sectionHeader}>Select Appliance</Text>
        <View style={styles.chipGrid}>
          {APPLIANCES.map((item) => (
            <Pressable 
              key={item} 
              style={[styles.chip, appliance === item && styles.chipActive]}
              onPress={() => setAppliance(item)}
            >
              <Text style={[styles.chipText, appliance === item && styles.chipTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.divider} />

        {/* 2. BRAND SELECTION */}
        <Text style={styles.sectionHeader}>Select Brand</Text>
        <View style={styles.chipRow}>
          {visibleBrands.map((item) => (
            <Pressable 
              key={item} 
              style={[styles.chip, brand === item && styles.chipActive]}
              onPress={() => setBrand(item)}
            >
              <Text style={[styles.chipText, brand === item && styles.chipTextActive]}>{item}</Text>
            </Pressable>
          ))}
          {!showAllBrands && (
            <Pressable style={styles.chip} onPress={() => setShowAllBrands(true)}>
              <Text style={styles.chipText}>More...</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.divider} />

        {/* 3. PROBLEM DESCRIPTION (VOICE OR TEXT) */}
        <View style={styles.headerRow}>
          <Text style={styles.sectionHeader}>Describe Problem</Text>
          <View style={styles.toggleRow}>
            <Pressable onPress={() => setInputMode('voice')} style={[styles.toggleBtn, inputMode === 'voice' && styles.toggleBtnActive]}>
              <Text style={[styles.toggleText, inputMode === 'voice' && styles.toggleTextActive]}>Voice</Text>
            </Pressable>
            <Pressable onPress={() => setInputMode('text')} style={[styles.toggleBtn, inputMode === 'text' && styles.toggleBtnActive]}>
              <Text style={[styles.toggleText, inputMode === 'text' && styles.toggleTextActive]}>Type</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.inputArea}>
          {inputMode === 'voice' ? (
            <HoldToRecordVoice 
              uri={problemAudio ? problemAudio : null}
              onChange={(uri) => setProblemAudio(uri || '')}
            />
          ) : (
            <TextInput
              style={styles.textInput}
              placeholder="E.g., It's making a loud clicking noise and not cooling..."
              placeholderTextColor="#94a3b8"
              multiline
              value={problemText}
              onChangeText={setProblemText}
            />
          )}
        </View>

        {/* Adds just enough padding so the last input isn't cramped */}
        <View style={{ height: 20 }} />
      </ScrollView>

      {/* 🪄 NEW: The button now lives outside the ScrollView, docked safely at the bottom */}
      <View style={styles.stickyFooter}>
        <Pressable 
          style={[styles.nextBtn, !isStep2Valid && styles.nextBtnDisabled]}
          disabled={!isStep2Valid}
          onPress={onNext}
        >
          <Text style={styles.nextBtnText}>Next</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

// ------------------------------------------------------------------
// 🎨 STYLES
// ------------------------------------------------------------------

const vnStyles = StyleSheet.create({
  container: { paddingVertical: 20, alignItems: 'center', width: '100%' },
  err: { color: "#b91c1c", fontSize: 13, fontWeight: "600", marginBottom: 12 },
  
  audioPlayerMock: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: '#cbd5e1', width: '100%' },
  playBtn: { backgroundColor: "#0f172a", borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10, marginRight: 12 },
  playText: { color: "white", fontWeight: "900", fontSize: 12 },
  grow: { flex: 1 },
  ok: { color: "#059669", fontWeight: "700", fontSize: 14 },
  dur: { color: "#64748b", fontSize: 13, marginTop: 2, fontVariant: ["tabular-nums"] },
  trashBtn: { borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },

  micWrapper: { alignItems: 'center' },
  micButton: { 
    backgroundColor: '#3b82f6', 
    width: 120, 
    height: 120, 
    borderRadius: 60, 
    justifyContent: 'center', 
    alignItems: 'center', 
    shadowColor: '#3b82f6', 
    shadowOpacity: 0.4, 
    shadowRadius: 15, 
    shadowOffset: { width: 0, height: 8 }, 
    elevation: 8 
  },
  micButtonActive: { 
    backgroundColor: '#ef4444', 
    shadowColor: '#ef4444',
    transform: [{ scale: 1.05 }] 
  },
  micHelper: { marginTop: 24, fontSize: 15, color: '#64748b', fontWeight: '500' },
  micHelperActive: { color: '#ef4444', fontWeight: '700' },
});

const styles = StyleSheet.create({
  stepContainer: { flex: 1, paddingTop: 20 },
  title: { fontSize: 28, fontWeight: '800', fontStyle: 'italic', color: '#0f172a', marginBottom: 24 },
  
  sectionHeader: { fontSize: 13, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginBottom: 12, letterSpacing: 0.5 },
  
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  chipActive: { backgroundColor: '#1c1917', borderColor: '#1c1917' },
  chipText: { color: '#475569', fontWeight: '600', fontSize: 14 },
  chipTextActive: { color: '#ffffff' },

  divider: { height: 1, backgroundColor: '#e2e8f0', marginVertical: 24 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  toggleRow: { flexDirection: 'row', backgroundColor: '#f1f5f9', borderRadius: 8, padding: 4 },
  toggleBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  toggleBtnActive: { backgroundColor: '#ffffff', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  toggleText: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  toggleTextActive: { color: '#0f172a' },

  inputArea: { minHeight: 180, justifyContent: 'center' },
  textInput: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, padding: 16, height: 160, fontSize: 16, color: '#0f172a', textAlignVertical: 'top' },
  
  // 🪄 NEW: Sticky Footer Styling
  stickyFooter: {
    paddingVertical: 16,
    paddingBottom: 20, // Extra padding for the absolute bottom of the screen
    backgroundColor: 'transparent',
  },
  nextBtn: { backgroundColor: '#1c1917', paddingVertical: 18, borderRadius: 24, alignItems: 'center' },
  nextBtnDisabled: { backgroundColor: '#cbd5e1' },
  nextBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },
});