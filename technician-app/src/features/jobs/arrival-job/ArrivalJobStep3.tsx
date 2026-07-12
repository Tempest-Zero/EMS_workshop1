/**
 * Step 3 — diagnosis (F12/W5). Fault + action chips come from the seeded
 * catalog vocabulary (scoped to the job's category), so the picked ids are
 * the same slugs the reliability analytics run on. Offline the pickers are
 * unavailable — codes stay optional-forever (flag-never-block), so the tech
 * can proceed and add them later from the completion form.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, Pressable, SafeAreaView, ScrollView, Platform } from 'react-native';

import { catalogApi, type CatalogActionCode, type CatalogFaultCode } from '../../../lib/catalogApi';

interface Step3Props {
  categoryId: string | null;
  faultId: string | null;
  actionId: string | null;
  onPick: (faultId: string | null, actionId: string | null) => void;
  onNext: () => void;
}

export function ArrivalJobStep3({ categoryId, faultId, actionId, onPick, onNext }: Step3Props) {
  const [faults, setFaults] = useState<CatalogFaultCode[] | null>(null);
  const [actions, setActions] = useState<CatalogActionCode[] | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [f, a] = await Promise.all([
          catalogApi.faultCodes(categoryId),
          catalogApi.actionCodes(categoryId),
        ]);
        if (!cancelled) {
          setFaults(f);
          setActions(a);
          setOffline(false);
        }
      } catch {
        if (!cancelled) {
          setFaults([]);
          setActions([]);
          setOffline(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  const loading = faults === null || actions === null;
  const haveCodes = !loading && !offline && (faults.length > 0 || actions.length > 0);
  // Soft-mandatory when the vocabulary is available; free pass when it isn't.
  const isComplete = !haveCodes || (faultId !== null && actionId !== null);

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
            <Text style={styles.stepBadgeText}>3 / 6</Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#2563eb" />
          </View>
        ) : offline || (faults.length === 0 && actions.length === 0) ? (
          <View style={styles.offlineBox}>
            <Text style={styles.offlineText}>
              {offline
                ? "Diagnosis codes need a connection — continue, and add them later from the completion form."
                : "No diagnosis vocabulary is seeded for this appliance yet — continue without codes."}
            </Text>
          </View>
        ) : (
          <>
            {/* 🛑 FAULT CHIPS */}
            <Text style={styles.sectionTitle}>Fault —</Text>
            <View style={styles.chipGrid}>
              {faults.map((fault) => {
                const isActive = faultId === fault.id;
                return (
                  <Pressable
                    key={fault.id}
                    style={[styles.chip, isActive && styles.chipActive]}
                    onPress={() => onPick(fault.id, actionId)}
                  >
                    <Text style={[styles.chipTextEn, isActive && styles.chipTextActive]}>
                      {fault.label_en ?? fault.id}
                    </Text>
                    {fault.label_ur ? (
                      <Text style={[styles.chipTextUr, isActive && styles.chipTextActive]}>
                        {' '}{fault.label_ur}
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
              {actions.map((action) => {
                const isActive = actionId === action.id;
                return (
                  <Pressable
                    key={action.id}
                    style={[styles.chip, isActive && styles.chipActive]}
                    onPress={() => onPick(faultId, action.id)}
                  >
                    <Text style={[styles.chipTextEn, isActive && styles.chipTextActive]}>
                      {action.label_en ?? action.id}
                    </Text>
                    {action.label_ur ? (
                      <Text style={[styles.chipTextUr, isActive && styles.chipTextActive]}>
                        {' '}{action.label_ur}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

      </ScrollView>

      {/* 🚀 STICKY FOOTER NAVIGATION */}
      <View style={styles.stickyFooter}>

        {haveCodes ? (
          <Pressable
            style={styles.skipBtn}
            onPress={() => {
              onPick(null, null);
              onNext();
            }}
          >
            <Text style={styles.skipBtnText}>skip — codes stay optional</Text>
          </Pressable>
        ) : null}

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

  loadingBox: { paddingVertical: 60, alignItems: 'center' },
  offlineBox: { backgroundColor: '#fef3c7', borderColor: '#fde68a', borderWidth: 1, borderRadius: 12, padding: 16 },
  offlineText: { color: '#92400e', fontSize: 14, fontWeight: '600', lineHeight: 20 },

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
