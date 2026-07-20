import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, Pressable, TextInput, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import { getLocation } from '../../attendance/location';
import { SchedulePickerModal } from '../SchedulePickerModal';
import { loadRecents, rememberPick, searchAddress, type AddressCandidate } from './addressSearch';

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

// Honest failure copy — the on-device geocoder needs network + Play
// Services, and search quality is address-grade, not Places-grade.
const SEARCH_MSG: Record<'no_match' | 'outside' | 'offline', string> = {
  no_match: 'No match found — try the area name, or drop the pin on the map.',
  outside: 'That address resolved outside Karachi — check the spelling or drop the pin manually.',
  offline: 'No connection — address search needs internet; drop the pin manually.',
};

export function CreateJobStep3({ location, setLocation, customerLat, customerLng, setCustomerPin, serviceType, setServiceType, timeWindow, setTimeWindow, onNext }: Step3Props) {
  const [showCalendar, setShowCalendar] = useState(false);
  const [locating, setLocating] = useState(false);

  // Address search (hardened on-device geocoder pipeline — addressSearch.ts).
  const mapRef = useRef<MapView | null>(null);
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<AddressCandidate[]>([]);
  const [searchMsg, setSearchMsg] = useState<string | null>(null);
  const [recents, setRecents] = useState<AddressCandidate[]>([]);

  useEffect(() => {
    void loadRecents().then(setRecents);
  }, []);

  const runSearch = async () => {
    if (searching || location.trim().length < 3) return;
    setSearching(true);
    setSearchMsg(null);
    setCandidates([]);
    try {
      const res = await searchAddress(location);
      if (res.status === 'ok') setCandidates(res.candidates);
      else setSearchMsg(SEARCH_MSG[res.status]);
    } finally {
      setSearching(false);
    }
  };

  const pickCandidate = (c: AddressCandidate) => {
    setLocation(c.label);
    setCustomerPin(c.lat, c.lng);
    setCandidates([]);
    setSearchMsg(c.approximate ? 'Area-level match — drag the pin to the exact house.' : null);
    // initialRegion only applies on first render — move the camera explicitly.
    mapRef.current?.animateToRegion(
      { latitude: c.lat, longitude: c.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 },
      500,
    );
    void rememberPick(c).then(loadRecents).then(setRecents);
  };

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
                ref={mapRef}
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
            onChangeText={(t) => {
              setLocation(t);
              // Typing invalidates the last search's suggestions/message.
              setCandidates([]);
              setSearchMsg(null);
            }}
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => void runSearch()}
          />
          <Pressable
            style={styles.searchBtn}
            onPress={() => void runSearch()}
            disabled={searching || location.trim().length < 3}
          >
            {searching ? (
              <ActivityIndicator size="small" color="#334155" />
            ) : (
              <Text style={styles.searchBtnText}>Find</Text>
            )}
          </Pressable>
        </View>

        {searchMsg ? <Text style={styles.helperText}>{searchMsg}</Text> : null}

        {candidates.map((c) => (
          <Pressable
            key={`${c.lat},${c.lng}`}
            style={styles.candidateRow}
            onPress={() => pickCandidate(c)}
          >
            <Text style={styles.candidateLabel} numberOfLines={2}>📌 {c.label}</Text>
            {c.approximate ? (
              <Text style={styles.candidateHint}>Area only — drag the pin to the exact house</Text>
            ) : null}
          </Pressable>
        ))}

        {candidates.length === 0 && !searchMsg && location.trim().length < 3 && recents.length > 0 ? (
          <View>
            <Text style={styles.recentsTitle}>Recent</Text>
            {recents.slice(0, 3).map((c) => (
              <Pressable key={c.label} style={styles.candidateRow} onPress={() => pickCandidate(c)}>
                <Text style={styles.candidateLabel} numberOfLines={1}>🕘 {c.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

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

  searchBtn: { marginLeft: 8, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#f1f5f9', minWidth: 52, alignItems: 'center' },
  searchBtnText: { fontSize: 12, fontWeight: '700', color: '#334155' },
  candidateRow: { marginTop: 8, backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', paddingVertical: 10, paddingHorizontal: 12 },
  candidateLabel: { fontSize: 13, color: '#0f172a', fontWeight: '600' },
  candidateHint: { fontSize: 12, color: '#b45309', marginTop: 2 },
  recentsTitle: { fontSize: 12, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12, marginLeft: 4 },
  
  spacer: { height: 24 },
  
  stickyFooter: { paddingVertical: 12, paddingBottom: Platform.OS === 'ios' ? 24 : 16, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  nextBtn: { backgroundColor: '#1c1917', paddingVertical: 18, borderRadius: 24, alignItems: 'center' },
  nextBtnDisabled: { backgroundColor: '#cbd5e1' },
  nextBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },
});