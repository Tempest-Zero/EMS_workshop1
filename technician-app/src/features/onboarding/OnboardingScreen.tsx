/**
 * First-run explainer for the geofence attendance reminders. Shown once, right
 * after the first login, BEFORE the OS permission dialogs — priming the "why"
 * is what turns the scary "Allow all the time" location prompt into a yes.
 *
 * Built for a tech with little app exposure: big icons, short lines, a little
 * Urdu alongside the English, one obvious button. Granting is best-effort —
 * we never block entry to the app on it; a tech who taps "Maybe later" just
 * gets the reminders off until they enable location for the app in Settings.
 */

import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ensureGeofenceMonitoring } from "../attendance/geofence";
import { markOnboarded, requestAttendancePermissions } from "./permissions";

function Point({
  icon,
  title,
  sub,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  sub: string;
}) {
  return (
    <View style={styles.point}>
      <View style={styles.iconWrap}>
        <Feather name={icon} size={20} color="#0f172a" />
      </View>
      <View style={styles.pointText}>
        <Text style={styles.pointTitle}>{title}</Text>
        <Text style={styles.pointSub}>{sub}</Text>
      </View>
    </View>
  );
}

export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);

  const finish = async (request: boolean) => {
    setBusy(true);
    try {
      if (request) await requestAttendancePermissions();
      await markOnboarded();
      void ensureGeofenceMonitoring(); // start monitoring if the grant came through
    } finally {
      setBusy(false);
      onDone();
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <Feather name="map-pin" size={32} color="#059669" />
      </View>
      <Text style={styles.h1}>Never forget to clock in</Text>
      <Text style={styles.lead}>
        FixFlow can remind you the moment you reach the workshop — so a forgotten
        punch never costs you a day.{"\n"}
        <Text style={styles.urdu}>ورکشاپ پہنچتے ہی حاضری کی یاد دہانی</Text>
      </Text>

      <View style={styles.card}>
        <Point
          icon="bell"
          title="A reminder when you arrive"
          sub="A tap clocks you in. Another reminds you to clock out when you leave."
        />
        <Point
          icon="map-pin"
          title="Location, set to “Allow all the time”"
          sub="Needed so the reminder works even when the app is closed. We only check the workshop fence — never track your day."
        />
        <Point
          icon="shield"
          title="Proof you were here"
          sub="Your arrival is logged, so “I forgot to punch” is never your word against the office."
        />
        <Point
          icon="battery-charging"
          title="Allow battery exception"
          sub="So the phone doesn’t stop reminders to save battery while you work. بیٹری کی اجازت دیں"
        />
      </View>

      <Pressable
        style={[styles.btn, busy ? styles.btnDisabled : null]}
        onPress={() => void finish(true)}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>Turn on reminders</Text>
        )}
      </Pressable>
      <Pressable onPress={() => void finish(false)} disabled={busy} style={styles.skip}>
        <Text style={styles.skipText}>Maybe later</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    paddingTop: 72,
    paddingBottom: 40,
    backgroundColor: "#f8fafc",
    flexGrow: 1,
  },
  hero: {
    alignSelf: "center",
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#ecfdf5",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  h1: { fontSize: 26, fontWeight: "800", color: "#0f172a", textAlign: "center" },
  lead: {
    fontSize: 15,
    color: "#475569",
    textAlign: "center",
    marginTop: 10,
    lineHeight: 22,
  },
  urdu: { fontSize: 15, color: "#0f172a", fontWeight: "600" },
  card: {
    marginTop: 28,
    backgroundColor: "white",
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    gap: 18,
  },
  point: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
  },
  pointText: { flex: 1 },
  pointTitle: { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  pointSub: { fontSize: 13, color: "#64748b", marginTop: 2, lineHeight: 19 },
  btn: {
    marginTop: 28,
    backgroundColor: "#059669",
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: "white", fontWeight: "800", fontSize: 17 },
  skip: { marginTop: 14, alignItems: "center", padding: 8 },
  skipText: { color: "#64748b", fontWeight: "700", fontSize: 14 },
});
