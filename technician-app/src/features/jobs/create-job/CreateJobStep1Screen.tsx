import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, Pressable, TextInput, Keyboard } from 'react-native';

interface Step1Props {
  phone: string;
  setPhone: (val: string | ((prev: string) => string)) => void;
  name: string;
  setName: (val: string) => void;
  isExisting: boolean | null;
  setIsExisting: (val: boolean | null) => void;
  onNext: () => void;
}

export function CreateJobStep1({ phone, setPhone, name, setName, isExisting, setIsExisting, onNext }: Step1Props) {
  const [showMatch, setShowMatch] = useState(false);
  const [showNumpad, setShowNumpad] = useState(true);

  useEffect(() => {
    if (phone === '0312' || phone === '0312447') {
      setShowMatch(true);
      if (isExisting !== true) setIsExisting(null); 
    } else if (phone.length < 4) {
      setShowMatch(false);
      setName('');
      setIsExisting(null);
    }
  }, [phone, isExisting, setIsExisting, setName]);

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
    setShowMatch(false);
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

      {showMatch && isExisting === null && (
        <View style={styles.matchCard}>
          <Text style={styles.matchText}>
            <Text style={{ fontWeight: '700' }}>Bilal</Text> — Gulshan · seen Mar '26
          </Text>
          <View style={styles.matchActions}>
            <Pressable style={styles.btnYes} onPress={() => { setIsExisting(true); setName('Bilal'); setShowNumpad(false); }}>
              <Text style={styles.btnYesText}>Yes, him</Text>
            </Pressable>
            <Pressable style={styles.btnNo} onPress={() => { setIsExisting(false); setName(''); setShowNumpad(false); }}>
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
  spacer: { flex: 1 },
  
  keypad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginBottom: 24 },
  key: { width: '31%', height: 50, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  keyPressed: { backgroundColor: '#f1f5f9' },
  keyText: { fontSize: 20, fontWeight: '500', color: '#334155' },
  
  nextBtn: { backgroundColor: '#1c1917', paddingVertical: 18, borderRadius: 24, alignItems: 'center', marginBottom: 20 },
  nextBtnDisabled: { backgroundColor: '#cbd5e1' },
  nextBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },
});