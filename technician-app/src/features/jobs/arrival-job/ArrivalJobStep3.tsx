import React, { useState } from 'react';
import { StyleSheet, Text, View, Pressable, SafeAreaView, ScrollView, Platform } from 'react-native';

interface Step3Props {
  onNext: () => void;
}

// Data matching your F12 wireframe (English + Urdu)
const FAULTS = [
  { id: 'compressor', en: 'Compressor', ur: 'کمپریسر' },
  { id: 'gas_leak', en: 'Gas leak', ur: 'گیس لیک' },
  { id: 'thermostat', en: 'Thermostat', ur: '' },
  { id: 'pcb', en: 'PCB', ur: '' },
  { id: 'fan', en: 'Fan', ur: '' },
  { id: 'door_seal', en: 'Door seal', ur: '' },
];

const ACTIONS = ['Regas', 'Replace part', 'Repair'];

export function ArrivalJobStep3({ onNext }: Step3Props) {
  const [selectedFault, setSelectedFault] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<string | null>(null);

  // Soft-mandatory: They must pick a fault and action to proceed normally
  const isComplete = selectedFault !== null && selectedAction !== null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView 
        contentContainerStyle={styles.scrollContent} 
        showsVerticalScrollIndicator={false}
      >
        {/* 🟢 HEADER */}
        <View style={styles.headerRow}>
          <Text style={styles.title}>Diagnosis</Text>
          <View style={styles.stepBadge}>
            <Text style={styles.stepBadgeText}>3 / 5</Text>
          </View>
        </View>

        {/* 🛑 FAULT CHIPS */}
        <Text style={styles.sectionTitle}>Fault —</Text>
        <View style={styles.chipGrid}>
          {FAULTS.map((fault) => {
            const isActive = selectedFault === fault.id;
            return (
              <Pressable 
                key={fault.id}
                style={[styles.chip, isActive && styles.chipActive]}
                onPress={() => setSelectedFault(fault.id)}
              >
                <Text style={[styles.chipTextEn, isActive && styles.chipTextActive]}>
                  {fault.en}
                </Text>
                {fault.ur ? (
                  <Text style={[styles.chipTextUr, isActive && styles.chipTextActive]}>
                    {' '}{fault.ur}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.divider} />

        {/* 🛠️ ACTION CHIPS */}
        <Text style={styles.sectionTitle}>Action —</Text>
        <View style={styles.chipGrid}>
          {ACTIONS.map((action) => {
            const isActive = selectedAction === action;
            return (
              <Pressable 
                key={action}
                style={[styles.chip, isActive && styles.chipActive]}
                onPress={() => setSelectedAction(action)}
              >
                <Text style={[styles.chipTextEn, isActive && styles.chipTextActive]}>
                  {action}
                </Text>
              </Pressable>
            );
          })}
        </View>

      </ScrollView>

      {/* 🚀 STICKY FOOTER NAVIGATION */}
      <View style={styles.stickyFooter}>
        
        {/* Skip button (soft gate fallback) */}
        <Pressable style={styles.skipBtn} onPress={() => console.log('Open skip reason logged')}>
          <Text style={styles.skipBtnText}>skip — pick a reason (logged)</Text>
        </Pressable>

        <Pressable 
          style={[styles.nextBtn, !isComplete && styles.nextBtnDisabled]}
          disabled={!isComplete}
          onPress={onNext}
        >
          <Text style={styles.nextBtnText}>Next</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  scrollContent: { paddingHorizontal: 24, paddingTop: Platform.OS === 'android' ? 40 : 20, paddingBottom: 40 },
  
  // Header
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 },
  title: { fontSize: 28, fontWeight: '800', fontStyle: 'italic', color: '#0f172a' },
  stepBadge: { backgroundColor: '#eff6ff', paddingVertical: 6, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: '#bfdbfe' },
  stepBadgeText: { color: '#2563eb', fontWeight: '800', fontSize: 14, fontVariant: ['tabular-nums'] },

  // Sections
  sectionTitle: { fontSize: 18, color: '#475569', fontWeight: '600', marginBottom: 16, fontStyle: 'italic' },
  divider: { height: 1, backgroundColor: '#f1f5f9', marginVertical: 32 },

  // Chips
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 24, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  chipActive: { backgroundColor: '#1c1917', borderColor: '#1c1917' },
  chipTextEn: { color: '#475569', fontWeight: '700', fontSize: 15 },
  chipTextUr: { color: '#475569', fontWeight: '600', fontSize: 15, fontFamily: Platform.OS === 'ios' ? 'Geeza Pro' : 'sans-serif' },
  chipTextActive: { color: '#ffffff' },

  // Sticky Footer
  stickyFooter: { paddingVertical: 16, paddingHorizontal: 24, paddingBottom: Platform.OS === 'ios' ? 32 : 16, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  
  skipBtn: { alignItems: 'center', marginBottom: 16, paddingVertical: 8 },
  skipBtnText: { color: '#64748b', fontSize: 14, fontWeight: '500', textDecorationLine: 'underline' },

  nextBtn: { backgroundColor: '#1c1917', paddingVertical: 18, borderRadius: 24, alignItems: 'center' },
  nextBtnDisabled: { backgroundColor: '#cbd5e1' },
  nextBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },
});