import React, { useState, useMemo } from 'react';
import { StyleSheet, Text, View, Pressable, SafeAreaView, ScrollView, Platform, TextInput, KeyboardAvoidingView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Step4Props {
  onNext: () => void;
}

// Dummy database of materials based on the wireframe
const INVENTORY = [
  { id: 'gas', name: 'R-134a gas', price: 1800 },
  { id: 'copper', name: 'Copper pipe /ft', price: 350 },
  { id: 'compressor', name: 'Standard Compressor', price: 12000 },
];

export function ArrivalJobStep4({ onNext }: Step4Props) {
  // State to track the quantity of each material
  const [quantities, setQuantities] = useState<Record<string, number>>({
    gas: 1,
    copper: 3,
  });

  const [customItem, setCustomItem] = useState('');

  const estimatedTotal = 3500; // Hardcoded estimate from Step 1 / Job Details

  // 🧠 "No mental math" feature: Dynamically calculates the actual total
  const actualTotal = useMemo(() => {
    let total = 0;
    INVENTORY.forEach(item => {
      const qty = quantities[item.id];
      if (qty) {
        total += qty * item.price;
      }
    });
    return total;
  }, [quantities]);

  const updateQuantity = (id: string, delta: number) => {
    setQuantities(prev => {
      const current = prev[id] || 0;
      const next = Math.max(0, current + delta); // Prevent negative numbers
      return { ...prev, [id]: next };
    });
  };

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
            <Text style={styles.title}>Materials</Text>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>4 / 5</Text>
            </View>
          </View>

          {/* 💰 ESTIMATE VS ACTUAL BANNER */}
          <View style={styles.budgetBanner}>
            <Text style={styles.budgetText}>
              Estimated Rs{estimatedTotal.toLocaleString()} - actual so far 
              <Text style={styles.budgetActual}> Rs{actualTotal.toLocaleString()}</Text>
            </Text>
          </View>

          {/* 📦 INVENTORY LIST */}
          <View style={styles.inventoryContainer}>
            {INVENTORY.map((item) => {
              const count = quantities[item.id] || 0;
              return (
                <View key={item.id} style={styles.inventoryRow}>
                  <Text style={styles.inventoryName}>
                    {item.name} <Text style={styles.inventoryPrice}>- Rs{item.price.toLocaleString()}</Text>
                  </Text>
                  
                  {/* +/- Stepper */}
                  <View style={styles.stepper}>
                    <Pressable style={styles.stepBtn} onPress={() => updateQuantity(item.id, -1)}>
                      <Ionicons name="remove" size={20} color="#475569" />
                    </Pressable>
                    <Text style={styles.stepCount}>{count}</Text>
                    <Pressable style={styles.stepBtn} onPress={() => updateQuantity(item.id, 1)}>
                      <Ionicons name="add" size={20} color="#475569" />
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>

          {/* ✍️ CUSTOM ITEM (RAW FALLBACK) */}
          <View style={styles.customItemBox}>
            <TextInput
              style={styles.customInput}
              placeholder="+ not in list - type name, resolves later"
              placeholderTextColor="#94a3b8"
              value={customItem}
              onChangeText={setCustomItem}
            />
          </View>

        </ScrollView>

        {/* 🚀 STICKY FOOTER */}
        <View style={styles.stickyFooter}>
          <Pressable style={styles.nextBtn} onPress={onNext}>
            <Text style={styles.nextBtnText}>Next</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  scrollContent: { paddingHorizontal: 24, paddingTop: Platform.OS === 'android' ? 40 : 20, paddingBottom: 40 },
  
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  title: { fontSize: 28, fontWeight: '800', fontStyle: 'italic', color: '#0f172a' },
  stepBadge: { backgroundColor: '#eff6ff', paddingVertical: 6, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: '#bfdbfe' },
  stepBadgeText: { color: '#2563eb', fontWeight: '800', fontSize: 14, fontVariant: ['tabular-nums'] },

  budgetBanner: { backgroundColor: '#eff6ff', borderRadius: 12, paddingVertical: 16, paddingHorizontal: 20, alignItems: 'center', marginBottom: 32, borderWidth: 1, borderColor: '#bfdbfe', borderStyle: 'dashed' },
  budgetText: { color: '#1e3a8a', fontSize: 15, fontWeight: '500' },
  budgetActual: { fontWeight: '800' },

  inventoryContainer: { gap: 16, marginBottom: 24 },
  inventoryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, paddingHorizontal: 20, borderRadius: 16, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  inventoryName: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  inventoryPrice: { color: '#64748b', fontWeight: '500' },
  
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f1f5f9', borderRadius: 20, borderWidth: 1, borderColor: '#e2e8f0' },
  stepBtn: { padding: 8, paddingHorizontal: 12 },
  stepCount: { fontSize: 16, fontWeight: '700', color: '#0f172a', minWidth: 24, textAlign: 'center' },

  customItemBox: { marginTop: 8 },
  customInput: { backgroundColor: '#fafaf9', borderWidth: 2, borderColor: '#d6d3d1', borderStyle: 'dashed', borderRadius: 16, padding: 16, fontSize: 15, color: '#0f172a', fontWeight: '500' },

  stickyFooter: { paddingVertical: 16, paddingHorizontal: 24, paddingBottom: Platform.OS === 'ios' ? 32 : 16, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  nextBtn: { backgroundColor: '#1c1917', paddingVertical: 18, borderRadius: 24, alignItems: 'center' },
  nextBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },
});