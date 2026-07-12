/**
 * Step 5 — the AFTER-video gate (F10). Evidence before data, exactly the
 * client's order: the work-done clip is captured BEFORE outcome & time can
 * be entered, precedented by the required closing video. Hard gate — no
 * skip. Uploads eagerly via the wizard (offline → pending-media queue).
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View, Pressable, SafeAreaView, ScrollView, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import type { MediaType, Phase } from '../../../lib/api';
import type { ArrivalDraft, UploadState } from './arrivalDraft';

interface AfterVideoProps {
  draft: ArrivalDraft;
  /** Register the capture: patch the draft AND kick its eager upload. */
  onCapture: (
    slot: string,
    patch: Partial<ArrivalDraft>,
    phase: Phase,
    type: MediaType,
    uri: string,
    contentType: string,
  ) => void;
  onNext: () => void;
}

export function ArrivalAfterVideoScreen({ draft, onCapture, onNext }: AfterVideoProps) {
  const { afterVideoUri, uploads } = draft;
  const [isLaunchingCamera, setIsLaunchingCamera] = useState(false);

  const recordVideo = async () => {
    setIsLaunchingCamera(true);
    try {
      const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
      if (!permissionResult.granted) return;

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        videoMaxDuration: 15,
        quality: 0.5,
      });

      const asset = result.canceled ? undefined : result.assets[0];
      if (asset?.uri) {
        onCapture(
          'after-video',
          { afterVideoUri: asset.uri },
          'after',
          'video',
          asset.uri,
          asset.mimeType ?? 'video/mp4',
        );
      }
    } finally {
      setIsLaunchingCamera(false);
    }
  };

  const uploadState: UploadState | undefined = uploads['after-video'];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        <View style={styles.headerRow}>
          <Text style={styles.title}>After-video</Text>
          <View style={styles.stepBadge}>
            <Text style={styles.stepBadgeText}>5 / 6</Text>
          </View>
        </View>
        <Text style={styles.subtitle}>
          Show the work done — the repaired unit running, the replaced part.
        </Text>

        {isLaunchingCamera ? (
          <View style={styles.actionBox}>
            <ActivityIndicator size="large" color="#3b82f6" />
            <Text style={styles.actionSubtext}>Opening Camera...</Text>
          </View>
        ) : !afterVideoUri ? (
          <Pressable style={styles.actionBoxActive} onPress={() => void recordVideo()}>
            <Ionicons name="videocam-outline" size={48} color="#2563eb" style={{ marginBottom: 12 }} />
            <Text style={styles.actionTitle}>Record After-Video</Text>
            <Text style={styles.actionSubtext}>Tap to start 15s video</Text>
          </Pressable>
        ) : (
          <View style={styles.actionBoxDone}>
            <Ionicons name="checkmark-circle" size={56} color="#16a34a" style={{ marginBottom: 8 }} />
            <Text style={[styles.actionTitle, { color: '#166534' }]}>After-video captured</Text>
            <Text style={styles.actionSubtext}>
              {uploadState === 'uploading'
                ? 'Uploading…'
                : uploadState === 'queued'
                  ? 'Saved — uploads when reconnected'
                  : uploadState === 'failed'
                    ? 'Upload rejected — retake before continuing'
                    : 'Attached to the job.'}
            </Text>
            <Pressable style={styles.retakeBtn} onPress={() => void recordVideo()}>
              <Text style={styles.retakeText}>Retake</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.footerMottoContainer}>
          <Text style={styles.footerMottoText}>evidence before data — hard gate</Text>
        </View>

      </ScrollView>

      <View style={styles.stickyFooter}>
        <Pressable
          style={[styles.nextBtn, !afterVideoUri && styles.nextBtnDisabled]}
          disabled={!afterVideoUri}
          onPress={onNext}
        >
          <Text style={styles.nextBtnText}>Continue to Outcome & Time</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  scrollContent: { paddingHorizontal: 24, paddingTop: Platform.OS === 'android' ? 40 : 20, paddingBottom: 40 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', fontStyle: 'italic', color: '#0f172a' },
  stepBadge: { backgroundColor: '#eff6ff', paddingVertical: 6, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: '#bfdbfe' },
  stepBadgeText: { color: '#2563eb', fontWeight: '800', fontSize: 14, fontVariant: ['tabular-nums'] },
  subtitle: { fontSize: 15, color: '#64748b', fontWeight: '500', marginBottom: 24 },

  actionBox: { backgroundColor: '#f8fafc', minHeight: 260, borderRadius: 20, borderWidth: 2, borderColor: '#e2e8f0', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', marginBottom: 32, padding: 20 },
  actionBoxActive: { backgroundColor: '#eff6ff', minHeight: 260, borderRadius: 20, borderWidth: 2, borderColor: '#3b82f6', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', marginBottom: 32, padding: 20 },
  actionBoxDone: { backgroundColor: '#f0fdf4', minHeight: 260, borderRadius: 20, borderWidth: 2, borderColor: '#22c55e', justifyContent: 'center', alignItems: 'center', marginBottom: 32, padding: 20 },
  actionTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 6 },
  actionSubtext: { fontSize: 14, fontWeight: '500', color: '#64748b', textAlign: 'center' },

  retakeBtn: { marginTop: 16, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 24, backgroundColor: '#ffffff' },
  retakeText: { color: '#475569', fontWeight: '700', fontSize: 14 },

  footerMottoContainer: { alignItems: 'center', marginTop: 10 },
  footerMottoText: { fontSize: 13, color: '#94a3b8', fontWeight: '600', letterSpacing: 0.5 },

  stickyFooter: { paddingVertical: 16, paddingHorizontal: 24, paddingBottom: Platform.OS === 'ios' ? 32 : 16, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  nextBtn: { backgroundColor: '#1c1917', paddingVertical: 18, borderRadius: 24, alignItems: 'center' },
  nextBtnDisabled: { backgroundColor: '#cbd5e1' },
  nextBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },
});
