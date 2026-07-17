/**
 * Travel to the customer (F6/F7) — the 0035/0037 travel flow:
 *
 *   pin editor     → a home-visit with NO pin can't start travel; the tech
 *                    drops/drags the pin on the map first (outbox `customer_pin`,
 *                    idempotent by value, audited server-side).
 *   START TRAVEL   → depart_workshop GPS punch (outbox, idempotent) + arms
 *                    the breadcrumb sampler (foreground-service task).
 *   map            → customer home pin + the tech's live blue dot + the leg's
 *                    recorded trail (polyline from the sampler's local store).
 *   Navigate       → hands off to the Google Maps app (free deep link).
 *   I HAVE ARRIVED → soft-block gate (arrivalGate): a confident fix >250 m
 *                    from the pin is refused with the distance; anything
 *                    uncertain passes (the server's ingest verdict is the
 *                    manager's backstop — flag, never block). Then the
 *                    arrive_customer punch, sampler stop, job hub.
 */
import type { CompositeScreenProps } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Crypto from "expo-crypto";
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';

import { haversineM } from "../../lib/geo";
import { jobsApi, type JobDetail, type LocationKind } from "../../lib/jobsApi";
import { loadJobDetail, saveJobDetail } from "../../lib/jobsCache";
import type { RootStackParamList } from "../../lib/navigation";
import { makeItem } from "../../lib/outbox";
import { sendOrQueue } from "../../lib/outboxSync";
import { getLocation, type LocationReading } from "../attendance/location";
import { useAuth } from "../auth/AuthContext";
import { evaluateArrival, formatDistanceM } from "./arrivalGate";
import { loadTravelTrail, startJobTravel, stopJobTravel } from "./travelTracker";
import type { JobsStackParamList } from "./types";

type Props = CompositeScreenProps<
  NativeStackScreenProps<JobsStackParamList, "Travel">,
  NativeStackScreenProps<RootStackParamList>
>;

const KARACHI = { latitude: 24.8607, longitude: 67.0011, latitudeDelta: 0.08, longitudeDelta: 0.08 };

/** A GPS reading that definitely has coordinates. */
interface Fix {
  lat: number;
  lng: number;
  accuracy_m: number | null;
  is_mock: boolean;
}

type LatLng = { latitude: number; longitude: number };

export function TravelScreen({ route, navigation }: Props) {
  const { id, token } = route.params;
  const { technician } = useAuth();

  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<"depart" | "arrive" | "pin" | null>(null);
  const [myFix, setMyFix] = useState<LocationReading | null>(null);
  const [draftPin, setDraftPin] = useState<LatLng | null>(null);
  const [trail, setTrail] = useState<LatLng[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const fresh = await jobsApi.get(id);
        if (!cancelled) setJob(fresh);
        void saveJobDetail(fresh);
      } catch {
        const cached = await loadJobDetail(id);
        if (!cancelled && cached) setJob(cached.data);
      }
    })();
    void getLocation().then((fix) => {
      if (!cancelled) setMyFix(fix);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Punches pair up into trips: a depart without its arrive means the tech is
  // on the road. Counting (not `some`) lets a re-visit — reschedule, part
  // pickup, customer-unreachable retry — start a NEW trip after an earlier
  // arrival, instead of the first arrive punch hiding START TRAVEL forever.
  const departs = job?.locations.filter((l) => l.kind === "depart_workshop").length ?? 0;
  const arrives = job?.locations.filter((l) => l.kind === "arrive_customer").length ?? 0;
  const inTransit = departs > arrives;

  const pin: LatLng | null =
    job?.customer_lat != null && job.customer_lng != null
      ? { latitude: job.customer_lat, longitude: job.customer_lng }
      : null;
  // A visit job with no pin gets the editor instead of START TRAVEL — the pin
  // is what arrival is verified against, so travel can't start without one.
  const editingPin = job !== null && pin === null && !inTransit;

  /** One GPS read shared by the gate and the punch — one fix, one truth. */
  const readFix = useCallback(async (): Promise<Fix | null> => {
    try {
      const loc = await getLocation();
      if (loc.lat == null || loc.lng == null) {
        setError("Couldn't get your location — enable GPS and try again.");
        return null;
      }
      setMyFix(loc);
      return {
        lat: loc.lat,
        lng: loc.lng,
        accuracy_m: loc.accuracy_m,
        is_mock: loc.is_mock_location,
      };
    } catch {
      setError("Couldn't get your location — enable GPS and try again.");
      return null;
    }
  }, []);

  /** Queue-or-send the punch (outbox, idempotent). True = landed or queued. */
  const sendPunch = useCallback(
    async (kind: LocationKind, fix: Fix): Promise<boolean> => {
      const body = {
        kind,
        lat: fix.lat,
        lng: fix.lng,
        accuracy_m: fix.accuracy_m,
        is_mock: fix.is_mock,
        device_time: new Date().toISOString(),
        client_id: Crypto.randomUUID(),
      };
      try {
        const detail = await sendOrQueue(
          makeItem({
            id: `location:${kind}:${id}`,
            kind: "location",
            jobId: id,
            payload: { body },
          }),
          () => jobsApi.recordLocation(id, body),
        );
        if (detail) setJob(detail);
        else setInfo("Punch saved offline — syncing when reconnected.");
        return true;
      } catch {
        setError("Couldn't record the punch — try again.");
        return false;
      }
    },
    [id],
  );

  const startTravel = async () => {
    if (busy || !pin) return;
    setBusy("depart");
    setError(null);
    setInfo(null);
    try {
      const fix = await readFix();
      if (!fix) return;
      const ok = await sendPunch("depart_workshop", fix);
      if (ok && technician) {
        // Punch landed (or queued) → start the breadcrumb trail for this leg.
        await startJobTravel(id, technician.id);
      }
    } finally {
      setBusy(null);
    }
  };

  const arrive = async () => {
    if (busy) return;
    setBusy("arrive");
    setError(null);
    setInfo(null);
    try {
      const fix = await readFix();
      if (!fix) return;
      // TAP-TIME GATE (the only gate — an offline-queued punch replays
      // ungated by design; the server's ingest verdict is the backstop).
      const gate = evaluateArrival(fix, pin ? { lat: pin.latitude, lng: pin.longitude } : null);
      if (gate.verdict === "block") {
        setError(
          `You're ${formatDistanceM(gate.distanceM)} from the customer's pin — get closer, or fix the pin if it's in the wrong place.`,
        );
        return;
      }
      if (!(await sendPunch("arrive_customer", fix))) return;
      await stopJobTravel(technician?.id ?? null); // privacy stop + final drain
      Alert.alert("Arrival recorded", "Entering the job hub.", [
        {
          text: "OK",
          onPress: () => {
            navigation.navigate("JobDetail", { id, token });
            setTimeout(() => {
              navigation.navigate("ArrivalWizard", { id, token, arrivalTime: Date.now() });
            }, 300);
          },
        },
      ]);
    } finally {
      setBusy(null);
    }
  };

  const savePin = async () => {
    if (busy || !draftPin) return;
    setBusy("pin");
    setError(null);
    setInfo(null);
    try {
      const body = { lat: draftPin.latitude, lng: draftPin.longitude };
      const detail = await sendOrQueue(
        makeItem({ id: `customer_pin:${id}`, kind: "customer_pin", jobId: id, payload: body }),
        () => jobsApi.setCustomerPin(id, body),
      );
      if (detail) {
        setJob(detail);
        void saveJobDetail(detail);
      } else {
        // Queued offline: reflect the pin locally so START TRAVEL unblocks —
        // the outbox replay is idempotent by value on the server.
        setJob((j) => (j ? { ...j, customer_lat: body.lat, customer_lng: body.lng } : j));
        setInfo("Pin saved offline — syncing when reconnected.");
      }
      setDraftPin(null);
    } catch {
      setError("Couldn't save the pin — try again.");
    } finally {
      setBusy(null);
    }
  };

  const locateMe = async () => {
    const fix = await readFix();
    if (fix) setDraftPin({ latitude: fix.lat, longitude: fix.lng });
  };

  // The leg's recorded trail, polled from the sampler's local store while in
  // transit — the tech SEES the path being recorded for the fuel bill.
  useEffect(() => {
    if (!inTransit) {
      setTrail([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const t = await loadTravelTrail();
      if (!cancelled) {
        setTrail(
          t && t.jobId === id
            ? t.points.map((p) => ({ latitude: p.lat, longitude: p.lng }))
            : [],
        );
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [inTransit, id]);

  const openNavigation = () => {
    if (job?.customer_lat != null && job.customer_lng != null) {
      void Linking.openURL(`google.navigation:q=${job.customer_lat},${job.customer_lng}`);
    } else if (job?.customer_address) {
      void Linking.openURL(`geo:0,0?q=${encodeURIComponent(job.customer_address)}`);
    }
  };

  const distanceKm =
    pin && myFix?.lat != null && myFix.lng != null
      ? haversineM(myFix.lat, myFix.lng, pin.latitude, pin.longitude) / 1000
      : null;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1e293b" />

      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerSub}>Navigating to</Text>
          <Text style={styles.headerTitle}>Job #{token}</Text>
        </View>
        {pin || job?.customer_address ? (
          <Pressable style={styles.navBtn} onPress={openNavigation}>
            <Text style={styles.navBtnText}>🧭 Navigate</Text>
          </Pressable>
        ) : null}
      </View>

      {/* 🗺️ REAL MAP — customer pin + live position + the recorded trail */}
      <View style={styles.mapArea}>
        {job === null ? (
          <View style={styles.mapLoading}>
            <ActivityIndicator size="large" color="#3b82f6" />
          </View>
        ) : (
          <MapView
            style={StyleSheet.absoluteFill}
            showsUserLocation
            initialRegion={
              pin
                ? { ...pin, latitudeDelta: 0.05, longitudeDelta: 0.05 }
                : myFix?.lat != null && myFix.lng != null
                  ? {
                      latitude: myFix.lat,
                      longitude: myFix.lng,
                      latitudeDelta: 0.05,
                      longitudeDelta: 0.05,
                    }
                  : KARACHI
            }
            onPress={
              editingPin ? (e) => setDraftPin(e.nativeEvent.coordinate) : undefined
            }
          >
            {pin ? <Marker coordinate={pin} title={job.customer_name} /> : null}
            {editingPin && draftPin ? (
              <Marker
                draggable
                coordinate={draftPin}
                onDragEnd={(e) => setDraftPin(e.nativeEvent.coordinate)}
              />
            ) : null}
            {trail.length >= 2 ? (
              <Polyline coordinates={trail} strokeColor="#3b82f6" strokeWidth={4} />
            ) : null}
          </MapView>
        )}

        {editingPin ? (
          <Pressable style={styles.myLocationBtn} onPress={() => void locateMe()}>
            <Text style={styles.myLocationText}>📍 My location</Text>
          </Pressable>
        ) : null}

        <View style={styles.etaCard}>
          {editingPin ? (
            <Text style={styles.etaDistance}>
              {draftPin
                ? 'Pin dropped — drag to adjust, then save.'
                : "Tap the map on the customer's home to drop the pin"}
            </Text>
          ) : distanceKm != null ? (
            <>
              <Text style={styles.etaTime}>{distanceKm.toFixed(1)} km</Text>
              <Text style={styles.etaDistance}>straight line to the customer</Text>
            </>
          ) : (
            <Text style={styles.etaDistance}>
              {pin ? "Getting your position…" : "No home pin on this job"}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.footer}>
        {job?.customer_address ? (
          <Text style={styles.addressText}>📍 {job.customer_address}</Text>
        ) : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {info ? <Text style={styles.infoText}>{info}</Text> : null}

        {editingPin ? (
          <>
            <Text style={styles.instructionText}>
              Drop the customer's home pin first — your arrival is verified against it, and the
              route to it is billed.
            </Text>
            <Pressable
              style={[
                styles.actionBtn,
                styles.pinBtn,
                (busy === "pin" || !draftPin) && styles.btnBusy,
              ]}
              disabled={!!busy || !draftPin}
              onPress={() => void savePin()}
            >
              <Text style={styles.actionBtnText}>
                {busy === "pin" ? "Saving…" : "📌 SAVE PIN"}
              </Text>
            </Pressable>
          </>
        ) : !inTransit ? (
          <>
            <Text style={styles.instructionText}>
              Punch out of the workshop — your route is recorded for the fuel bill.
            </Text>
            <Pressable
              style={[styles.actionBtn, styles.departBtn, busy === "depart" && styles.btnBusy]}
              disabled={!!busy}
              onPress={() => void startTravel()}
            >
              <Text style={styles.actionBtnText}>
                {busy === "depart" ? "Recording…" : "🚀 START TRAVEL"}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.instructionText}>
              Drive safely. Tap below once you reach the customer's gate or door.
            </Text>
            <Pressable
              style={[styles.actionBtn, styles.arriveBtn, busy === "arrive" && styles.btnBusy]}
              disabled={!!busy}
              onPress={() => void arrive()}
            >
              <Text style={styles.actionBtnText}>
                {busy === "arrive" ? "Checking distance…" : "I HAVE ARRIVED"}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1e293b' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 32 : 20,
    paddingBottom: 20,
    backgroundColor: '#1e293b',
  },
  backButton: { paddingRight: 16, paddingVertical: 8 },
  backArrow: { fontSize: 24, color: '#ffffff', fontWeight: '300' },
  headerText: { flex: 1 },
  headerSub: { fontSize: 13, color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase' },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#ffffff' },
  navBtn: {
    backgroundColor: '#334155',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#475569',
  },
  navBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },

  mapArea: { flex: 1, backgroundColor: '#e2e8f0', position: 'relative', overflow: 'hidden' },
  mapLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  myLocationBtn: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    backgroundColor: '#ffffff',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  myLocationText: { fontSize: 13, fontWeight: '700', color: '#0f172a' },

  etaCard: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    backgroundColor: '#ffffff',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 30,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
    alignItems: 'center',
  },
  etaTime: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  etaDistance: { fontSize: 13, fontWeight: '600', color: '#64748b', marginTop: 2 },

  footer: {
    backgroundColor: '#ffffff',
    padding: 24,
    paddingBottom: 32,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -20,
  },
  addressText: { fontSize: 14, color: '#334155', fontWeight: '600', marginBottom: 10 },
  errorText: { color: '#b91c1c', fontSize: 13, fontWeight: '600', marginBottom: 8 },
  infoText: { color: '#b45309', fontSize: 13, fontWeight: '600', marginBottom: 8 },
  instructionText: { fontSize: 14, color: '#64748b', textAlign: 'center', marginBottom: 18, lineHeight: 20 },

  actionBtn: {
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  departBtn: { backgroundColor: '#0f172a', shadowColor: '#0f172a' },
  arriveBtn: { backgroundColor: '#10b981', shadowColor: '#10b981' },
  pinBtn: { backgroundColor: '#2563eb', shadowColor: '#2563eb' },
  btnBusy: { opacity: 0.6 },
  actionBtnText: { color: '#ffffff', fontSize: 18, fontWeight: '800', letterSpacing: 0.5 },
});
