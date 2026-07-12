/**
 * Step 4 — materials (F13/W6). The picker lists the seeded parts catalog
 * (scoped to the job's category, cross-category parts included); prices are
 * NOT catalog data — every line's unit price is this job's dated, located
 * price observation, typed by the tech. Free-text custom lines stay possible
 * (C7 raw+resolved: the name resolves to a part later, curation-side).
 * Offline the catalog list is empty and custom lines carry the whole step.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, Pressable, SafeAreaView, ScrollView, Platform, TextInput, KeyboardAvoidingView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { catalogApi, type CatalogPart } from '../../../lib/catalogApi';
import { formatPaisa, rupeesToPaisa } from '../../../lib/money';
import type { MaterialLine } from './arrivalDraft';

interface Step4Props {
  categoryId: string | null;
  materials: MaterialLine[];
  setMaterials: (lines: MaterialLine[]) => void;
  onNext: () => void;
}

export function ArrivalJobStep4({ categoryId, materials, setMaterials, onNext }: Step4Props) {
  const [parts, setParts] = useState<CatalogPart[]>([]);
  const [customName, setCustomName] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const fetched = await catalogApi.parts(categoryId);
        if (!cancelled) setParts(fetched);
      } catch {
        /* offline — custom lines carry the step */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  const lineFor = (name: string) => materials.find((m) => m.name === name);

  const setLine = (name: string, patch: Partial<MaterialLine>) => {
    const existing = lineFor(name);
    if (existing) {
      setMaterials(
        materials
          .map((m) => (m.name === name ? { ...m, ...patch } : m))
          .filter((m) => m.qty > 0),
      );
    } else {
      setMaterials([...materials, { name, qty: 1, unit_paisa: 0, ...patch }]);
    }
  };

  const bumpQty = (name: string, delta: number) => {
    const existing = lineFor(name);
    const next = Math.max(0, (existing?.qty ?? 0) + delta);
    setLine(name, { qty: next });
  };

  const addCustom = () => {
    const name = customName.trim();
    if (!name || lineFor(name)) return;
    setMaterials([...materials, { name, qty: 1, unit_paisa: 0 }]);
    setCustomName('');
  };

  const actualPaisa = materials.reduce((sum, m) => sum + m.qty * m.unit_paisa, 0);

  // Catalog rows first (with any picked quantities), then custom lines that
  // aren't catalog names.
  const catalogNames = new Set(parts.map((p) => p.name_canonical));
  const customLines = materials.filter((m) => !catalogNames.has(m.name));

  const renderLine = (name: string, subtitle?: string | null) => {
    const line = lineFor(name);
    const qty = line?.qty ?? 0;
    return (
      <View key={name} style={styles.inventoryRow}>
        <View style={styles.lineLeft}>
          <Text style={styles.inventoryName}>{name}</Text>
          {subtitle ? <Text style={styles.inventoryPrice}>{subtitle}</Text> : null}
          {qty > 0 ? (
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>Rs</Text>
              <TextInput
                style={styles.priceInput}
                keyboardType="number-pad"
                placeholder="unit price"
                placeholderTextColor="#94a3b8"
                value={line && line.unit_paisa > 0 ? String(line.unit_paisa / 100) : ''}
                onChangeText={(v) => setLine(name, { unit_paisa: rupeesToPaisa(v) })}
              />
              <Text style={styles.priceEach}>each</Text>
            </View>
          ) : null}
        </View>

        {/* +/- Stepper */}
        <View style={styles.stepper}>
          <Pressable style={styles.stepBtn} onPress={() => bumpQty(name, -1)}>
            <Ionicons name="remove" size={20} color="#475569" />
          </Pressable>
          <Text style={styles.stepCount}>{qty}</Text>
          <Pressable style={styles.stepBtn} onPress={() => bumpQty(name, 1)}>
            <Ionicons name="add" size={20} color="#475569" />
          </Pressable>
        </View>
      </View>
    );
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
              <Text style={styles.stepBadgeText}>4 / 6</Text>
            </View>
          </View>

          {/* 💰 RUNNING TOTAL — no mental math */}
          <View style={styles.budgetBanner}>
            <Text style={styles.budgetText}>
              Materials so far
              <Text style={styles.budgetActual}> {formatPaisa(actualPaisa)}</Text>
            </Text>
          </View>

          {/* 📦 CATALOG PARTS */}
          <View style={styles.inventoryContainer}>
            {parts.map((p) =>
              renderLine(p.name_canonical, p.quality ? `(${p.quality})` : null),
            )}
            {customLines.map((m) => renderLine(m.name, 'custom — resolves later'))}
            {parts.length === 0 && customLines.length === 0 ? (
              <Text style={styles.emptyText}>
                Parts list unavailable (offline or not seeded) — add lines below.
              </Text>
            ) : null}
          </View>

          {/* ✍️ CUSTOM ITEM (RAW FALLBACK) */}
          <View style={styles.customItemBox}>
            <TextInput
              style={styles.customInput}
              placeholder="+ not in list - type name, resolves later"
              placeholderTextColor="#94a3b8"
              value={customName}
              onChangeText={setCustomName}
              onSubmitEditing={addCustom}
              returnKeyType="done"
            />
            {customName.trim() ? (
              <Pressable style={styles.addBtn} onPress={addCustom}>
                <Text style={styles.addBtnText}>Add "{customName.trim()}"</Text>
              </Pressable>
            ) : null}
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
  lineLeft: { flex: 1, paddingRight: 12 },
  inventoryName: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  inventoryPrice: { color: '#64748b', fontWeight: '500', fontSize: 13, marginTop: 2 },
  emptyText: { fontSize: 13, color: '#94a3b8', fontStyle: 'italic' },

  priceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  priceLabel: { fontSize: 14, fontWeight: '700', color: '#475569', marginRight: 6 },
  priceInput: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 15, minWidth: 90, color: '#0f172a', backgroundColor: '#f8fafc' },
  priceEach: { fontSize: 12, color: '#94a3b8', marginLeft: 6 },

  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f1f5f9', borderRadius: 20, borderWidth: 1, borderColor: '#e2e8f0' },
  stepBtn: { padding: 8, paddingHorizontal: 12 },
  stepCount: { fontSize: 16, fontWeight: '700', color: '#0f172a', minWidth: 24, textAlign: 'center' },

  customItemBox: { marginTop: 8 },
  customInput: { backgroundColor: '#fafaf9', borderWidth: 2, borderColor: '#d6d3d1', borderStyle: 'dashed', borderRadius: 16, padding: 16, fontSize: 15, color: '#0f172a', fontWeight: '500' },
  addBtn: { marginTop: 10, backgroundColor: '#0f172a', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  addBtnText: { color: 'white', fontWeight: '700', fontSize: 14 },

  stickyFooter: { paddingVertical: 16, paddingHorizontal: 24, paddingBottom: Platform.OS === 'ios' ? 32 : 16, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  nextBtn: { backgroundColor: '#1c1917', paddingVertical: 18, borderRadius: 24, alignItems: 'center' },
  nextBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },
});
