import React, { useState } from 'react';
import { StyleSheet, Text, View, Pressable, TextInput, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import { getLocation } from '../../attendance/location';
import { SchedulePickerModal } from '../SchedulePickerModal';

interface Step3Props {
  /** The customer address — held by the wizard so submit can send it. */
  location: string;
  setLocation: (val: string) => void;
  /** The home pin (0036) — the travel map + navigation hand-off read it. */
  customerLat: number | null;
  customerLng: number | null;
  setCustomerPin: (lat: number, lng: number) => void;
  serviceType: string;
  setServiceType: (val: string) => void;
  timeWindow: string;
  setTimeWindow: (val: string) => void;
  onNext: () => void;
}

// Karachi — the shop's city; the map has to open somewhere sensible when no
// pin is set and the tech's own GPS is unavailable.
const DEFAULT_REGION = {
  latitude: 24.8607,
  longitude: 67.0011,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

export function CreateJobStep3({ location, setLocation, customerLat, customerLng, setCustomerPin, serviceType, setServiceType, timeWindow, setTimeWindow, onNext }: Step3Props) {
  const [showCalendar, setShowCalendar] = useState(false);
  const [locating, setLocating] = useState(false);

  const isVisit = serviceType !== 'Carry-in';
  // Carry-in has no travel: the address and schedule are visit-only (the server
  // drops them anyway), so they can't gate the step for a carry-in.
  const isStep3Valid =
    serviceType !== '' && (!isVisit || (timeWindow !== '' && location.trim().length > 0));

  // "I'm standing at the customer's door" — pin from the tech's own GPS.
  const useMyLocation = async () => {
    if (locating) return;
    setLocating(true);
    try {
      const fix = await getLocation();
      if (fix.lat != null && fix.lng != null) {
        setCustomerPin(fix.lat, fix.lng);
      }
    } finally {
      setLocating(false);
    }
  };

  // Checks if the active time window is a custom date rather than the default presets
  const isCustomTime = timeWindow !== 'Today 4-6' && timeWindow !== 'Tmrw AM' && timeWindow !== '';

  return (
    <KeyboardAvoidingView 
      style={{ flex: 1 }} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
    >
      <ScrollView 
        style={styles.stepContainer}
        contentContainerStyle={{ paddingBottom: 40 }} 
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Where & how</Text>

        {/* 1. SERVICE TYPE CHIPS */}
        <View style={styles.chipRow}>
          {['Home visit', 'Carry-in', 'Pickup'].map((item) => (
            <Pressable 
              key={item} 
              style={[styles.chip, serviceType === item && styles.chipActive]}
              onPress={() => setServiceType(item)}
            >
              <Text style={[styles.chipText, serviceType === item && styles.chipTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </View>

        {/* 2. CUSTOMER HOME PIN (real map — the travel screen navigates to it) */}
        {isVisit ? (
          <>
            <View style={styles.mapContainer}>
              <MapView
                style={StyleSheet.absoluteFill}
                initialRegion={
                  customerLat != null && customerLng != null
                    ? { latitude: customerLat, longitude: customerLng, latitudeDelta: 0.02, longitudeDelta: 0.02 }
                    : DEFAULT_REGION
                }
                onPress={(e) =>
                  setCustomerPin(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude)
                }
              >
                {customerLat != null && customerLng != null ? (
                  <Marker
                    draggable
                    coordinate={{ latitude: customerLat, longitude: customerLng }}
                    onDragEnd={(e) =>
                      setCustomerPin(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude)
                    }
                  />
                ) : null}
              </MapView>
              <Pressable style={styles.myLocationBtn} onPress={() => void useMyLocation()}>
                <Text style={styles.myLocationText}>{locating ? '…' : '📍 My location'}</Text>
              </Pressable>
            </View>
            <Text style={styles.helperText}>
              {customerLat != null
                ? 'Pin set — drag it or tap the map to adjust.'
                : "Tap the map to drop the customer's home pin (optional)."}
            </Text>
          </>
        ) : null}

        <View style={styles.addressRow}>
          <Text style={styles.addressIcon}>📍</Text>
          <TextInput
            style={styles.addressInput}
            placeholder={isVisit ? 'Type customer address...' : 'Customer address (optional)...'}
            placeholderTextColor="#94a3b8"
            value={location}
            onChangeText={setLocation}
            autoCorrect={false}
          />
        </View>

        {/* Scheduling is visit-only — a carry-in is dropped off, there is no
            appointment window. */}
        {isVisit ? (
          <>
            <View style={styles.spacer} />

            {/* 3. SCHEDULING CHIPS (WITH POPUP TRIGGER) */}
            <View style={styles.chipRow}>
              {['Today 4-6', 'Tmrw AM'].map((item) => (
                <Pressable
                  key={item}
                  style={[styles.chip, timeWindow === item && styles.chipActive]}
                  onPress={() => setTimeWindow(item)}
                >
                  <Text style={[styles.chipText, timeWindow === item && styles.chipTextActive]}>{item}</Text>
                </Pressable>
              ))}

              {/* 🪄 The Custom "Pick..." Button */}
              <Pressable
                style={[styles.chip, isCustomTime && styles.chipActive]}
                onPress={() => setShowCalendar(true)}
              >
                <Text style={[styles.chipText, isCustomTime && styles.chipTextActive]}>
                  {isCustomTime ? timeWindow : '🗓️ Pick date...'}
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}

      </ScrollView>

      {/* STICKY FOOTER */}
      <View style={styles.stickyFooter}>
        <Pressable 
          style={[styles.nextBtn, !isStep3Valid && styles.nextBtnDisabled]}
          disabled={!isStep3Valid}
          onPress={onNext}
        >
          <Text style={styles.nextBtnText}>Next</Text>
        </Pressable>
      </View>

      <SchedulePickerModal
        visible={showCalendar}
        title="Schedule Task"
        onClose={() => setShowCalendar(false)}
        onConfirm={(_iso, label) => {
          setTimeWindow(label);
          setShowCalendar(false);
        }}
      />

    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  stepContainer: { flex: 1, paddingTop: 20 },
  title: { fontSize: 28, fontWeight: '800', fontStyle: 'italic', color: '#0f172a', marginBottom: 20 },
  
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  chipActive: { backgroundColor: '#1c1917', borderColor: '#1c1917' },
  chipText: { color: '#475569', fontWeight: '600', fontSize: 14 },
  chipTextActive: { color: '#ffffff' },

  mapContainer: { height: 200, backgroundColor: '#f0ebd8', borderRadius: 16, borderWidth: 1, borderColor: '#94a3b8', overflow: 'hidden', position: 'relative', marginTop: 8 },
  myLocationBtn: { position: 'absolute', top: 10, right: 10, backgroundColor: '#ffffff', borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: '#cbd5e1', elevation: 3 },
  myLocationText: { fontSize: 12, fontWeight: '700', color: '#334155' },
  addressRow: { marginTop: 12, backgroundColor: '#ffffff', paddingVertical: 4, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: '#cbd5e1', flexDirection: 'row', alignItems: 'center' },
  
  addressPill: { position: 'absolute', bottom: 12, left: 12, right: 12, backgroundColor: '#ffffff', paddingVertical: 4, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: '#cbd5e1', flexDirection: 'row', alignItems: 'center' },
  addressIcon: { fontSize: 14, marginRight: 8 },
  addressInput: { flex: 1, fontSize: 13, color: '#0f172a', fontWeight: '500', height: 36, padding: 0 },

  helperText: { fontSize: 13, color: '#64748b', marginTop: 12, marginLeft: 4 },
  
  spacer: { height: 24 },
  
  stickyFooter: { paddingVertical: 12, paddingBottom: Platform.OS === 'ios' ? 24 : 16, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  nextBtn: { backgroundColor: '#1c1917', paddingVertical: 18, borderRadius: 24, alignItems: 'center' },
  nextBtnDisabled: { backgroundColor: '#cbd5e1' },
  nextBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },
});