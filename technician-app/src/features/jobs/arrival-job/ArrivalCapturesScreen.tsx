import React, { useState } from 'react';
import { StyleSheet, Text, View, Pressable, SafeAreaView, ScrollView, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

interface Step1Props {
  onNext: () => void;
}

export function ArrivalCapturesScreen({ onNext }: Step1Props) {
  const [serialUri, setSerialUri] = useState<string | null>(null);
  const [conditionUris, setConditionUris] = useState<string[]>([]);
  const [errorCodeStatus, setErrorCodeStatus] = useState<'pending' | 'no' | 'yes_pending' | 'done'>('pending');
  const [errorCodeUri, setErrorCodeUri] = useState<string | null>(null);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [isLaunchingCamera, setIsLaunchingCamera] = useState(false);

  const getActiveStep = () => {
    if (!serialUri) return 1; 
    if (conditionUris.length < 2) return 2; 
    if (errorCodeStatus === 'pending' || errorCodeStatus === 'yes_pending') return 3; 
    if (!videoUri) return 4; 
    return 5; 
  };

  const activeStep = getActiveStep();
  const isComplete = activeStep === 5;

  const takePhoto = async (type: 'serial' | 'condition' | 'errorCode') => {
    setIsLaunchingCamera(true);
    try {
      const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
      if (!permissionResult.granted) {
        alert("We need camera permissions to capture job evidence.");
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.5, 
      });

      const asset = result.canceled ? undefined : result.assets[0];
      if (asset?.uri) {
        const uri = asset.uri;

        if (type === 'serial') {
          setSerialUri(uri);
        } else if (type === 'condition') {
          setConditionUris(prev => [...prev, uri]);
        } else if (type === 'errorCode') {
          setErrorCodeUri(uri);
          setErrorCodeStatus('done');
        }
      }
    } finally {
      setIsLaunchingCamera(false);
    }
  };

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
        setVideoUri(asset.uri);
      }
    } finally {
      setIsLaunchingCamera(false);
    }
  };

  const renderActionHub = () => {
    if (isLaunchingCamera) {
      return (
        <View style={styles.actionBox}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.actionSubtext}>Opening Camera...</Text>
        </View>
      );
    }

    switch (activeStep) {
      case 1:
        return (
          <Pressable style={styles.actionBoxActive} onPress={() => takePhoto('serial')}>
            <Ionicons name="barcode-outline" size={48} color="#2563eb" style={{ marginBottom: 12 }} />
            <Text style={styles.actionTitle}>Capture Serial Plate</Text>
            <Text style={styles.actionSubtext}>Tap to open camera</Text>
          </Pressable>
        );
      case 2:
        return (
          <Pressable style={styles.actionBoxActive} onPress={() => takePhoto('condition')}>
            <Ionicons name="images-outline" size={48} color="#2563eb" style={{ marginBottom: 12 }} />
            <Text style={styles.actionTitle}>Condition Snap ({conditionUris.length + 1} of 2)</Text>
            <Text style={styles.actionSubtext}>Document current appliance state</Text>
          </Pressable>
        );
      case 3:
        if (errorCodeStatus === 'pending') {
          return (
            <View style={styles.actionBox}>
              <Ionicons name="alert-circle-outline" size={48} color="#d97706" style={{ marginBottom: 12 }} />
              <Text style={styles.actionTitle}>Is there an error code?</Text>
              <View style={styles.buttonRow}>
                <Pressable style={[styles.choiceBtn, { backgroundColor: '#f1f5f9' }]} onPress={() => setErrorCodeStatus('no')}>
                  <Text style={styles.choiceBtnText}>No</Text>
                </Pressable>
                <Pressable style={[styles.choiceBtn, { backgroundColor: '#2563eb' }]} onPress={() => setErrorCodeStatus('yes_pending')}>
                  <Text style={[styles.choiceBtnText, { color: 'white' }]}>Yes</Text>
                </Pressable>
              </View>
            </View>
          );
        } else {
          return (
            <Pressable style={styles.actionBoxActive} onPress={() => takePhoto('errorCode')}>
              <Ionicons name="camera-outline" size={48} color="#2563eb" style={{ marginBottom: 12 }} />
              <Text style={styles.actionTitle}>Capture Error Code</Text>
              <Text style={styles.actionSubtext}>Take a photo of the display</Text>
            </Pressable>
          );
        }
      case 4:
        return (
          <Pressable style={styles.actionBoxActive} onPress={recordVideo}>
            <Ionicons name="videocam-outline" size={48} color="#2563eb" style={{ marginBottom: 12 }} />
            <Text style={styles.actionTitle}>Record Before-Video</Text>
            <Text style={styles.actionSubtext}>Tap to start 15s video</Text>
          </Pressable>
        );
      case 5:
        return (
          <View style={[styles.actionBox, { backgroundColor: '#f0fdf4', borderColor: '#22c55e', borderStyle: 'solid' }]}>
            <Ionicons name="checkmark-circle" size={56} color="#16a34a" style={{ marginBottom: 8 }} />
            <Text style={[styles.actionTitle, { color: '#166534' }]}>Evidence Secured</Text>
            <Text style={styles.actionSubtext}>All gates cleared.</Text>
            
            <View style={styles.ocrPill}>
              <Text style={styles.ocrPillText}>OCR: FRG-8817 extracted</Text>
            </View>
          </View>
        );
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        
        <View style={styles.headerRow}>
          <Text style={styles.title}>Arrival – captures</Text>
          <View style={styles.stepBadge}>
            <Text style={styles.stepBadgeText}>1 / 5</Text>
          </View>
        </View>

        {renderActionHub()}

        <View style={styles.checklistContainer}>
          
          <View style={styles.checkRow}>
            <Ionicons name={activeStep > 1 ? "checkmark-circle" : "ellipse-outline"} size={28} color={activeStep > 1 ? "#16a34a" : "#cbd5e1"} />
            <Text style={[styles.checkText, activeStep === 1 && styles.checkTextFocus, activeStep > 1 && styles.checkTextDone]}>
              Serial photo <Text style={{ color: '#94a3b8' }}>→ creates the unit</Text>
            </Text>
          </View>

          <View style={styles.checkRow}>
            <Ionicons name={activeStep > 2 ? "checkmark-circle" : "ellipse-outline"} size={28} color={activeStep > 2 ? "#16a34a" : "#cbd5e1"} />
            <Text style={[styles.checkText, activeStep === 2 && styles.checkTextFocus, activeStep > 2 && styles.checkTextDone]}>
              Condition snaps <Text style={{ fontWeight: '700' }}>({conditionUris.length}/2)</Text>
            </Text>
          </View>

          <View style={styles.checkRow}>
            <Ionicons name={activeStep > 3 ? "checkmark-circle" : "ellipse-outline"} size={28} color={activeStep > 3 ? "#16a34a" : "#cbd5e1"} />
            <Text style={[styles.checkText, activeStep === 3 && styles.checkTextFocus, activeStep > 3 && styles.checkTextDone]}>
              Error code? {errorCodeStatus === 'no' ? 'N/A' : errorCodeStatus === 'done' ? 'Logged' : 'y/n + photo'}
            </Text>
          </View>

          <View style={styles.checkRow}>
            <Ionicons name={activeStep > 4 ? "checkmark-circle" : "ellipse-outline"} size={28} color={activeStep > 4 ? "#16a34a" : "#cbd5e1"} />
            <Text style={[styles.checkText, activeStep === 4 && styles.checkTextFocus, activeStep > 4 && styles.checkTextDone]}>
              Before-video <Text style={{ fontStyle: 'italic', color: '#94a3b8' }}>(last gate)</Text>
            </Text>
          </View>

        </View>

        <View style={styles.footerMottoContainer}>
          <Text style={styles.footerMottoText}>automated progression, zero typing</Text>
        </View>
        
      </ScrollView>

      {/* DEV SKIP BUTTON */}
      <Pressable
        style={styles.devSkipBtn}
        onPress={onNext}
      >
        <Text style={styles.devSkipBtnText}>[DEV ONLY] Skip Captures</Text>
      </Pressable>

      <View style={styles.stickyFooter}>
        <Pressable 
          style={[styles.nextBtn, !isComplete && styles.nextBtnDisabled]}
          disabled={!isComplete}
          onPress={onNext} 
        >
          <Text style={styles.nextBtnText}>Continue to Voice Summary</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  scrollContent: { paddingHorizontal: 24, paddingTop: Platform.OS === 'android' ? 40 : 20, paddingBottom: 40 },
  
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  title: { fontSize: 28, fontWeight: '800', fontStyle: 'italic', color: '#0f172a' },
  stepBadge: { backgroundColor: '#eff6ff', paddingVertical: 6, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: '#bfdbfe' },
  stepBadgeText: { color: '#2563eb', fontWeight: '800', fontSize: 14, fontVariant: ['tabular-nums'] },

  actionBox: { backgroundColor: '#f8fafc', minHeight: 220, borderRadius: 20, borderWidth: 2, borderColor: '#e2e8f0', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', marginBottom: 32, padding: 20 },
  actionBoxActive: { backgroundColor: '#eff6ff', minHeight: 220, borderRadius: 20, borderWidth: 2, borderColor: '#3b82f6', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', marginBottom: 32, padding: 20 },
  actionTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 6 },
  actionSubtext: { fontSize: 14, fontWeight: '500', color: '#64748b' },
  
  buttonRow: { flexDirection: 'row', gap: 12, marginTop: 20 },
  choiceBtn: { paddingVertical: 12, paddingHorizontal: 32, borderRadius: 12 },
  choiceBtnText: { fontSize: 16, fontWeight: '700', color: '#475569' },

  ocrPill: { marginTop: 16, backgroundColor: '#ffffff', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: '#22c55e' },
  ocrPillText: { color: '#166534', fontWeight: '700', fontSize: 13 },

  checklistContainer: { gap: 20, marginBottom: 40 },
  checkRow: { flexDirection: 'row', alignItems: 'center', paddingRight: 16 },
  checkText: { marginLeft: 16, fontSize: 16, color: '#94a3b8', fontWeight: '500', flex: 1 },
  checkTextFocus: { color: '#0f172a', fontWeight: '700' },
  checkTextDone: { color: '#475569', fontWeight: '500', textDecorationLine: 'line-through' },

  footerMottoContainer: { alignItems: 'center', marginTop: 10 },
  footerMottoText: { fontSize: 13, color: '#94a3b8', fontWeight: '600', letterSpacing: 0.5 },

  // DEV SKIP STYLES
  devSkipBtn: { backgroundColor: '#fee2e2', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, alignItems: 'center', marginHorizontal: 24, marginBottom: 12, borderWidth: 1, borderColor: '#f87171' },
  devSkipBtnText: { color: '#b91c1c', fontSize: 14, fontWeight: '800' },

  stickyFooter: { paddingVertical: 16, paddingHorizontal: 24, paddingBottom: Platform.OS === 'ios' ? 32 : 16, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  nextBtn: { backgroundColor: '#1c1917', paddingVertical: 18, borderRadius: 24, alignItems: 'center' },
  nextBtnDisabled: { backgroundColor: '#cbd5e1' },
  nextBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },
});