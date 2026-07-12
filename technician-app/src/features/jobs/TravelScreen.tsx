/**
 * Travel to the customer (F6/F7) — the 0035 travel flow, wired for real:
 *
 *   START TRAVEL   → depart_workshop GPS punch (outbox, idempotent) + arms
 *                    the breadcrumb sampler (foreground-service task).
 *   map            → customer home pin (intake, 0036) + the tech's live blue
 *                    dot; straight-line distance from the last fix.
 *   Navigate       → hands off to the Google Maps app (free deep link).
 *   I HAVE ARRIVED → arrive_customer GPS punch (real fix, mock flag carried),
 *                    stops the sampler, drains the queue, opens the job hub.
 */
import type { CompositeScreenProps } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Crypto from "expo-crypto";
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import { haversineM } from "../../lib/geo";
import { jobsApi, type JobDetail, type LocationKind } from "../../lib/jobsApi";
import { loadJobDetail, saveJobDetail } from "../../lib/jobsCache";
import type { RootStackParamList } from "../../lib/navigation";
import { makeItem } from "../../lib/outbox";
import { sendOrQueue } from "../../lib/outboxSync";
import { getLocation, type LocationReading } from "../attendance/location";
import { useAuth } from "../auth/AuthContext";
import { startJobTravel, stopJobTravel } from "./travelTracker";
import type { JobsStackParamList } from "./types";

type Props = CompositeScreenProps<
  NativeStackScreenProps<JobsStackParamList, "Travel">,
  NativeStackScreenProps<RootStackParamList>
>;

const KARACHI = { latitude: 24.8607, longitude: 67.0011, latitudeDelta: 0.08, longitudeDelta: 0.08 };

export function TravelScreen({ route, navigation }: Props) {
  const { id, token } = route.params;
  const { technician } = useAuth();

  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<"depart" | "arrive" | null>(null);
  const [myFix, setMyFix] = useState<LocationReading | null>(null);

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

  const hasDepart = job?.locations.some((l) => l.kind === "depart_workshop") ?? false;

  const punch = useCallback(
    async (kind: LocationKind) => {
      if (busy) return null;
      setBusy(kind === "depart_workshop" ? "depart" : "arrive");
      setError(null);
      setInfo(null);
      try {
        const loc = await getLocation();
        if (loc.lat == null || loc.lng == null) {
          setError("Couldn't get your location — enable GPS and try again.");
          return null;
        }
        setMyFix(loc);
        const body = {
          kind,
          lat: loc.lat,
          lng: loc.lng,
          accuracy_m: loc.accuracy_m,
          is_mock: loc.is_mock_location,
          device_time: new Date().toISOString(),
          client_id: Crypto.randomUUID(),
        };
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
        return loc;
      } catch {
        setError("Couldn't record the punch — try again.");
        return null;
      } finally {
        setBusy(null);
      }
    },
    [id, busy],
  );

  const startTravel = async () => {
    const loc = await punch("depart_workshop");
    if (loc && technician) {
      // Punch landed (or queued) → start the breadcrumb trail for this leg.
      await startJobTravel(id, technician.id);
    }
  };

  const arrive = async () => {
    const loc = await punch("arrive_customer");
    if (!loc) return;
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
  };

  const openNavigation = () => {
    if (job?.customer_lat != null && job.customer_lng != null) {
      void Linking.openURL(`google.navigation:q=${job.customer_lat},${job.customer_lng}`);
    } else if (job?.customer_address) {
      void Linking.openURL(`geo:0,0?q=${encodeURIComponent(job.customer_address)}`);
    }
  };

  const pin =
    job?.customer_lat != null && job.customer_lng != null
      ? { latitude: job.customer_lat, longitude: job.customer_lng }
      : null;
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

      {/* 🗺️ REAL MAP — customer pin + the tech's live position */}
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
          >
            {pin ? <Marker coordinate={pin} title={job.customer_name} /> : null}
          </MapView>
        )}

        <View style={styles.etaCard}>
          {distanceKm != null ? (
            <>
              <Text style={styles.etaTime}>{distanceKm.toFixed(1)} km</Text>
              <Text style={styles.etaDistance}>straight line to the customer</Text>
            </>
          ) : (
            <Text style={styles.etaDistance}>
              {pin ? "Getting your position…" : "No home pin on this job — use the address"}
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

        {!hasDepart ? (
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
                {busy === "arrive" ? "Verifying GPS…" : "I HAVE ARRIVED"}
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
  btnBusy: { opacity: 0.6 },
  actionBtnText: { color: '#ffffff', fontSize: 18, fontWeight: '800', letterSpacing: 0.5 },
});
