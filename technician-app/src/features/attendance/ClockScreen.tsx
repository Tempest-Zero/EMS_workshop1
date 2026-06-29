/**
 * The technician clock-in/out screen. One big button, the current status, a
 * "pending sync" indicator, the recent punches with their evidence flags, and a
 * read-out of the currently-detected WiFi (so a manager can read the workshop
 * BSSID off the phone during setup). The technician identity is the signed-in
 * user — punches are attributed to whoever logged in.
 */

import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAttendance } from "./useAttendance";
import { getWifi, type WifiReading } from "./wifi";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

type Tone = "ok" | "warn" | "danger";

function Badge({ text, tone }: { text: string; tone: Tone }) {
  return <Text style={[styles.badge, styles[tone]]}>{text}</Text>;
}

export function ClockScreen() {
  const att = useAttendance();
  const [wifi, setWifi] = useState<WifiReading>({ wifi_bssid: null, wifi_ssid: null });

  useEffect(() => {
    void getWifi().then(setWifi);
  }, [att.punches.length]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.h1}>FixFlow · Attendance</Text>
      <Text style={styles.h2}>Clock in / out</Text>

      <View style={styles.identityBox}>
        <View>
          <Text style={styles.label}>Signed in as</Text>
          <Text style={styles.identity}>{att.technicianName || att.techId || "—"}</Text>
        </View>
        {att.shift ? (
          <View style={styles.shiftBox}>
            <Text style={styles.shiftLabel}>Shift Schedule</Text>
            <Text style={styles.shiftText}>
              {att.shift.start_local.slice(0, 5)} - {att.shift.end_local.slice(0, 5)}
            </Text>
            <Text style={styles.shiftSubtext}>
              {att.shift.grace_minutes} min grace period
            </Text>
          </View>
        ) : null}
      </View>

      {att.error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{att.error}</Text>
        </View>
      ) : null}

      <View style={[styles.card, att.clockedIn ? styles.cardOn : null]}>
        <Text style={styles.status}>{att.clockedIn ? "On duty" : "Not clocked in"}</Text>
        <Pressable
          style={[
            styles.btn,
            att.clockedIn ? styles.btnOut : styles.btnIn,
            att.busy ? styles.btnDisabled : null,
          ]}
          onPress={() => {
            void (att.clockedIn ? att.clockOut() : att.clockIn());
          }}
          disabled={att.busy}
        >
          {att.busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>{att.clockedIn ? "Clock Out" : "Clock In"}</Text>
          )}
        </Pressable>
        {att.pendingCount > 0 ? (
          <Text style={styles.pending}>{att.pendingCount} pending sync…</Text>
        ) : (
          <Text style={styles.synced}>All synced</Text>
        )}
      </View>

      {att.punches.some((p) => p.selfieFailed) && (
        <View style={styles.warningBox}>
          <Text style={styles.warningTitle}>⚠️ Photo Upload Failed</Text>
          <Text style={styles.warningText}>
            One or more punches didn't upload a selfie. Ensure you have a good connection when clocking in.
          </Text>
        </View>
      )}

      <View style={styles.field}>
        <Text style={styles.label}>Detected WiFi (for geofence setup)</Text>
        <Text style={styles.wifiText}>
          {wifi.wifi_ssid ?? "Not on WiFi"}
          {wifi.wifi_bssid ? `  ·  ${wifi.wifi_bssid}` : ""}
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Punch History</Text>
      {att.punches.length === 0 ? (
        <Text style={styles.empty}>No punches yet</Text>
      ) : (
        Object.entries(
          att.punches.reduce((acc, p) => {
            const d = fmtDate(p.at);
            (acc[d] ??= []).push(p);
            return acc;
          }, {} as Record<string, typeof att.punches>)
        ).map(([date, list]) => (
          <View key={date} style={styles.dayGroup}>
            <Text style={styles.dayHeader}>{date}</Text>
            {list.map((p) => (
              <View key={p.key} style={styles.row}>
                <View>
                  <Text style={styles.rowKind}>
                    {p.kind === "clock_in" ? "Clock In" : "Clock Out"}
                  </Text>
                  <Text style={styles.rowTime}>{fmtTime(p.at)}</Text>
                </View>
                <View style={styles.badges}>
                  {p.selfieFailed ? <Badge text="No Photo" tone="warn" /> : null}
                  {p.isMock ? <Badge text="MOCK" tone="danger" /> : null}
                  {p.hasWifi ? <Badge text="WiFi" tone="ok" /> : null}
                  <Badge text={p.synced ? "Synced" : "Pending"} tone={p.synced ? "ok" : "warn"} />
                </View>
              </View>
            ))}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingTop: 48,
    paddingBottom: 32,
    backgroundColor: "#f8fafc",
    flexGrow: 1,
  },
  h1: { fontSize: 22, fontWeight: "800", color: "#0f172a" },
  h2: { fontSize: 14, fontWeight: "600", color: "#475569", marginTop: 2 },
  field: { marginTop: 16 },
  identityBox: {
    marginTop: 16,
    backgroundColor: "white",
    borderColor: "#e2e8f0",
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748b",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  identity: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0f172a",
  },
  shiftBox: {
    alignItems: "flex-end",
  },
  shiftLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748b",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  shiftText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0f172a",
  },
  shiftSubtext: {
    fontSize: 11,
    color: "#64748b",
    marginTop: 2,
  },
  errorBox: {
    marginTop: 12,
    backgroundColor: "#fee2e2",
    borderRadius: 8,
    padding: 12,
  },
  warningBox: {
    marginTop: 12,
    backgroundColor: "#fffbeb",
    borderColor: "#fde68a",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  warningTitle: { color: "#92400e", fontSize: 14, fontWeight: "700", marginBottom: 4 },
  warningText: { color: "#92400e", fontSize: 13 },
  errorText: { color: "#b91c1c", fontSize: 13 },
  card: {
    marginTop: 16,
    backgroundColor: "white",
    borderRadius: 12,
    padding: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  cardOn: { backgroundColor: "#ecfdf5", borderColor: "#a7f3d0" },
  status: { fontSize: 18, fontWeight: "800", color: "#0f172a", marginBottom: 14 },
  btn: {
    width: "100%",
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: "center",
  },
  btnIn: { backgroundColor: "#059669" },
  btnOut: { backgroundColor: "#0f172a" },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: "white", fontWeight: "800", fontSize: 18 },
  pending: { marginTop: 12, color: "#b45309", fontWeight: "700", fontSize: 13 },
  synced: { marginTop: 12, color: "#059669", fontWeight: "700", fontSize: 13 },
  wifiText: {
    backgroundColor: "white",
    borderColor: "#cbd5e1",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: "#475569",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0f172a",
    marginTop: 28,
    marginBottom: 12,
  },
  empty: { color: "#94a3b8", fontStyle: "italic", fontSize: 14 },
  dayGroup: { marginBottom: 16 },
  dayHeader: {
    fontSize: 13,
    fontWeight: "700",
    color: "#475569",
    textTransform: "uppercase",
    marginBottom: 8,
    marginLeft: 4,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "white",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  rowKind: { fontWeight: "700", color: "#0f172a", fontSize: 14 },
  rowTime: { color: "#64748b", fontSize: 12, marginTop: 2 },
  badges: { flexDirection: "row", gap: 6, alignItems: "center" },
  badge: {
    fontSize: 10,
    fontWeight: "800",
    overflow: "hidden",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  ok: { backgroundColor: "#d1fae5", color: "#065f46" },
  warn: { backgroundColor: "#fef3c7", color: "#92400e" },
  danger: { backgroundColor: "#fee2e2", color: "#991b1b" },
});
