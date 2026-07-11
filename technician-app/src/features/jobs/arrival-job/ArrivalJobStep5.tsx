import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, Pressable, SafeAreaView, ScrollView, Platform, TextInput, KeyboardAvoidingView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Step5Props {
  arrivalTime: number;
  onComplete: () => void;
}

const OUTCOMES = ['Repaired', 'Not repairable', 'Needs part'];

export function ArrivalJobStep5({ arrivalTime, onComplete }: Step5Props) {
  const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null);
  
  const [isAdjustingTime, setIsAdjustingTime] = useState(false);
  const [timeReason, setTimeReason] = useState('');
  
  // ⏱️ Live Timer State
  const [elapsedMs, setElapsedMs] = useState(0);

  // Start the ticking clock!
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - arrivalTime);
    }, 1000);
    
    // Initial tick
    setElapsedMs(Date.now() - arrivalTime);
    
    return () => clearInterval(interval);
  }, [arrivalTime]);

  // Formats ms into "1h 42m 12s" or just "42m 12s"
  const formatTime = (ms: number) => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const isComplete = selectedOutcome !== null && (!isAdjustingTime || timeReason.trim().length > 0);

  return (
    <KeyboardAvoidingView 
      style={{ flex: 1 }} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
    >
      <SafeAreaView style={styles.container}>
        <ScrollView 
          contentContainerStyle={styles.scrollContent} 
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* 🟢 HEADER */}
          <View style={styles.headerRow}>
            <Text style={styles.title}>Outcome & time</Text>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>5 / 5</Text>
            </View>
          </View>

          {/* 🛠️ OUTCOME CHIPS */}
          <View style={styles.chipGrid}>
            {OUTCOMES.map((outcome) => {
              const isActive = selectedOutcome === outcome;
              return (
                <Pressable 
                  key={outcome}
                  style={[styles.chip, isActive && styles.chipActive]}
                  onPress={() => setSelectedOutcome(outcome)}
                >
                  <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                    {outcome}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.divider} />

          {/* ⏱️ LIVE TIME TRACKER */}
          <View style={styles.timeBox}>
            <View style={styles.timeRow}>
              <View style={styles.timeDisplay}>
                <Ionicons name="time-outline" size={20} color={isAdjustingTime ? "#ef4444" : "#475569"} style={{ marginRight: 8 }} />
                <Text style={[styles.timeText, isAdjustingTime && { color: '#ef4444', textDecorationLine: 'line-through' }]}>
                  {formatTime(elapsedMs)}
                </Text>
              </View>
              <View style={styles.stopwatchBadge}>
                {/* Visual pulse indicator to show it's live */}
                <View style={styles.pulseDot} />
                <Text style={styles.stopwatchText}>live stopwatch</Text>
              </View>
            </View>
            
            {!isAdjustingTime ? (
              <Pressable onPress={() => setIsAdjustingTime(true)}>
                <Text style={styles.adjustLink}>adjust — reason required</Text>
              </Pressable>
            ) : (
              <View style={styles.adjustReasonContainer}>
                <TextInput
                  style={styles.reasonInput}
                  placeholder="Reason for time adjustment..."
                  placeholderTextColor="#94a3b8"
                  value={timeReason}
                  onChangeText={setTimeReason}
                  autoFocus
                />
                <Pressable onPress={() => { setIsAdjustingTime(false); setTimeReason(''); }}>
                  <Text style={styles.cancelAdjust}>Cancel adjustment</Text>
                </Pressable>
              </View>
            )}
          </View>

        </ScrollView>

        {/* 🚀 STICKY FOOTER NAVIGATION */}
        <View style={styles.stickyFooter}>
          <Pressable 
            style={[styles.submitBtn, !isComplete && styles.submitBtnDisabled]}
            disabled={!isComplete}
            onPress={onComplete}
          >
            <Text style={styles.submitBtnText}>Submit → bill opens</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  scrollContent: { paddingHorizontal: 24, paddingTop: Platform.OS === 'android' ? 40 : 20, paddingBottom: 40 },
  
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 },
  title: { fontSize: 28, fontWeight: '800', fontStyle: 'italic', color: '#0f172a' },
  stepBadge: { backgroundColor: '#eff6ff', paddingVertical: 6, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: '#bfdbfe' },
  stepBadgeText: { color: '#2563eb', fontWeight: '800', fontSize: 14, fontVariant: ['tabular-nums'] },

  // Outcome Chips
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  chip: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 24, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  chipActive: { backgroundColor: '#1c1917', borderColor: '#1c1917' },
  chipText: { color: '#475569', fontWeight: '700', fontSize: 15 },
  chipTextActive: { color: '#ffffff' },

  divider: { height: 1, backgroundColor: '#f1f5f9', marginVertical: 32 },

  // Time Tracker
  timeBox: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 16, padding: 16, backgroundColor: '#f8fafc' },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  timeDisplay: { flexDirection: 'row', alignItems: 'center' },
  timeText: { fontSize: 18, fontWeight: '700', color: '#0f172a', fontVariant: ['tabular-nums'] },
  
  stopwatchBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  pulseDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ef4444', marginRight: 6 },
  stopwatchText: { fontSize: 12, color: '#64748b', fontWeight: '600', textTransform: 'uppercase' },
  
  adjustLink: { fontSize: 14, color: '#64748b', textDecorationLine: 'underline', fontWeight: '500' },
  
  adjustReasonContainer: { marginTop: 8 },
  reasonInput: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 12, fontSize: 15, color: '#0f172a' },
  cancelAdjust: { fontSize: 13, color: '#ef4444', marginTop: 12, fontWeight: '500', alignSelf: 'flex-start' },

  // Submit Button
  stickyFooter: { paddingVertical: 16, paddingHorizontal: 24, paddingBottom: Platform.OS === 'ios' ? 32 : 16, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  submitBtn: { backgroundColor: '#1c1917', paddingVertical: 18, borderRadius: 24, alignItems: 'center' },
  submitBtnDisabled: { backgroundColor: '#cbd5e1' },
  submitBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },
});