import React from 'react';
import { StyleSheet, Text, View, Pressable, TextInput, Switch, ScrollView } from 'react-native';

// The canonical recorder (double-tap-guarded; never orphans the mic). This
// file used to carry a stale inline copy of it — don't reintroduce one.
import { VoiceNote } from '../VoiceNote';

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
