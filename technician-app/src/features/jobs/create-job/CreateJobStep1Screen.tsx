import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, Pressable, TextInput, Keyboard } from 'react-native';

import { customersApi, type CustomerLookup } from '../../../lib/customersApi';

/** The intake channels the tech can pick at Step 1. Subset of the backend's
 * intake_channel enum — the phone only originates these three. */
export type IntakeChannel = 'walk_in' | 'phone' | 'whatsapp';

const CHANNELS: { value: IntakeChannel; label: string }[] = [
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'phone', label: 'Phone' },
  { value: 'whatsapp', label: 'WhatsApp' },
];

interface Step1Props {
  phone: string;
  setPhone: (val: string | ((prev: string) => string)) => void;
  name: string;
  setName: (val: string) => void;
  isExisting: boolean | null;
  setIsExisting: (val: boolean | null) => void;
  intakeChannel: IntakeChannel;
  setIntakeChannel: (val: IntakeChannel) => void;
  onNext: () => void;
}

export function CreateJobStep1({ phone, setPhone, name, setName, isExisting, setIsExisting, intakeChannel, setIntakeChannel, onNext }: Step1Props) {
  const [match, setMatch] = useState<CustomerLookup | null>(null);
  const [showNumpad, setShowNumpad] = useState(true);

  // Real repeat-customer lookup: debounce ~400 ms once the number is dialable,
  // then ask the server. A null answer (unknown / offline / ambiguous) simply
  // shows no card — the tech carries on as a new customer.
  useEffect(() => {
    if (phone.length < 10) {
      setMatch(null);
      if (isExisting !== true) setIsExisting(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      void customersApi
        .lookup(phone)
        .then((found) => {
          if (!cancelled) setMatch(found);
        })
        .catch(() => {
          if (!cancelled) setMatch(null); // offline / error → no card, silently
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [phone, isExisting, setIsExisting]);

  const handleKeyPress = (key: string) => {
    if (key === 'back') {
      setPhone((prev) => prev.slice(0, -1));
    } else if (phone.length < 11) {
      setPhone((prev) => prev + key);
    }
  };

  // 🪄 NEW: Instantly reset everything
  const clearPhone = () => {
    setPhone('');
    setName('');
    setIsExisting(null);
    setMatch(null);
  };

  const isStep1Valid = phone.length >= 10 && name.trim().length > 0;

  return (
    <View style={styles.stepContainer}>
      <Text style={styles.title}>Who</Text>

      <Pressable 
        style={styles.inputBox}
        onPress={() => {
          setShowNumpad(true);
          Keyboard.dismiss(); 
        }}
      >
        <Text style={[styles.inputText, !phone && styles.placeholderText]}>
          {phone ? `Phone · ${phone}` : 'Phone · 03XXXXXXXXX'}
        </Text>
        
        {/* 🪄 DYNAMIC CURSOR / CLEAR BUTTON */}
        {phone.length > 0 ? (
          <Pressable onPress={clearPhone} hitSlop={15} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>✕</Text>
          </Pressable>
        ) : (
          <View style={[styles.cursorBlock, !showNumpad && styles.cursorHidden]} />
        )}
      </Pressable>

      {match && isExisting === null && (
        <View style={styles.matchCard}>
          <Text style={styles.matchText}>
            <Text style={{ fontWeight: '700' }}>{match.full_name}</Text> — repeat customer
          </Text>
          <View style={styles.matchActions}>
            <Pressable style={styles.btnYes} onPress={() => { setIsExisting(true); setName(match.full_name); setShowNumpad(false); }}>
              <Text style={styles.btnYesText}>Yes, them</Text>
            </Pressable>
            <Pressable style={styles.btnNo} onPress={() => { setIsExisting(false); setShowNumpad(false); }}>
              <Text style={styles.btnNoText}>No, new</Text>
            </Pressable>
          </View>
        </View>
      )}

      <TextInput
        style={styles.nameInput}
        placeholder="Name"
        value={name}
        onChangeText={setName}
        editable={isExisting !== true}
        placeholderTextColor="#94a3b8"
        onFocus={() => setShowNumpad(false)}
      />

      {/* How did this job come in? Defaults to walk-in. */}
      <View style={styles.channelRow}>
        {CHANNELS.map((c) => (
          <Pressable
            key={c.value}
            style={[styles.channelChip, intakeChannel === c.value && styles.channelChipActive]}
            onPress={() => setIntakeChannel(c.value)}
          >
            <Text style={[styles.channelText, intakeChannel === c.value && styles.channelTextActive]}>
              {c.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.spacer} />

      {showNumpad && (
        <View style={styles.keypad}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'].map((key) => (
            <Pressable key={key} style={({ pressed }) => [styles.key, pressed && styles.keyPressed]} onPress={() => handleKeyPress(key)}>
              <Text style={styles.keyText}>{key === 'back' ? '⌫' : key}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Pressable 
        style={[styles.nextBtn, !isStep1Valid && styles.nextBtnDisabled]}
        disabled={!isStep1Valid}
        onPress={() => {
          Keyboard.dismiss(); 
          onNext();
        }}
      >
        <Text style={styles.nextBtnText}>Next</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  stepContainer: { flex: 1, paddingTop: 20 },
  title: { fontSize: 28, fontWeight: '800', fontStyle: 'italic', color: '#0f172a', marginBottom: 20 },
  
  inputBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#94a3b8', borderRadius: 12, paddingHorizontal: 16, height: 56, marginBottom: 16 },
  inputText: { fontSize: 16, color: '#0f172a', fontWeight: '500' },
  placeholderText: { color: '#94a3b8' },
  
  // Cursor and Clear Button Styles
  cursorBlock: { width: 12, height: 16, backgroundColor: '#0f172a' },
  cursorHidden: { backgroundColor: 'transparent' },
  clearBtn: { width: 24, height: 24, backgroundColor: '#e2e8f0', borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  clearBtnText: { color: '#64748b', fontSize: 12, fontWeight: '900' },

  matchCard: { backgroundColor: '#eff6ff', borderWidth: 1, borderStyle: 'dashed', borderColor: '#3b82f6', borderRadius: 12, padding: 16, marginBottom: 16 },
  matchText: { color: '#1e3a8a', fontSize: 14, marginBottom: 12 },
  matchActions: { flexDirection: 'row', gap: 8 },
  btnYes: { backgroundColor: '#1e293b', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20 },
  btnYesText: { color: 'white', fontWeight: '600', fontSize: 13 },
  btnNo: { backgroundColor: 'white', borderWidth: 1, borderColor: '#cbd5e1', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20 },
  btnNoText: { color: '#475569', fontWeight: '600', fontSize: 13 },
  
  nameInput: { borderWidth: 1, borderColor: '#94a3b8', borderRadius: 12, paddingHorizontal: 16, height: 56, fontSize: 16, color: '#0f172a', marginBottom: 16, backgroundColor: '#f8fafc' },

  channelRow: { flexDirection: 'row', gap: 8 },
  channelChip: { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#ffffff', alignItems: 'center' },
  channelChipActive: { backgroundColor: '#1c1917', borderColor: '#1c1917' },
  channelText: { fontSize: 14, fontWeight: '600', color: '#475569' },
  channelTextActive: { color: '#ffffff' },

  spacer: { flex: 1 },
  
  keypad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginBottom: 24 },
  key: { width: '31%', height: 50, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  keyPressed: { backgroundColor: '#f1f5f9' },
  keyText: { fontSize: 20, fontWeight: '500', color: '#334155' },
  
  nextBtn: { backgroundColor: '#1c1917', paddingVertical: 18, borderRadius: 24, alignItems: 'center', marginBottom: 20 },
  nextBtnDisabled: { backgroundColor: '#cbd5e1' },
  nextBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },
});