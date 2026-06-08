/**
 * Job Detail — customer, appliance, problem, the live timeline, and the SOP
 * actions a technician drives on-site:
 *   - add a note (Module 3 remarks) · mark Ready / Close (status)
 *   - Complete Job → auto-bill (P2d)
 *   - negotiate the bill, log cash, and correct (void) a payment (P2e, Module 4)
 *   - GPS punches for the home-visit route → distance + fuel estimate (P3b)
 * Every action calls the live backend and re-renders from the authoritative
 * JobDetail it returns. Cash + punches carry a client_id so an offline retry
 * never double-records (the backend dedups on it).
 */

import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { getLocation } from "../attendance/location";
import { JobMediaCapture } from "../media/JobMediaCapture";
import { uploadMedia } from "../media/uploadMedia";
import { jobsApi, type JobDetail } from "../../lib/jobsApi";
import { formatPaisa, rupeesToPaisa } from "../../lib/money";
import type { JobsStackParamList } from "./types";

type Props = NativeStackScreenProps<JobsStackParamList, "JobDetail">;

type Busy =
  | "note"
  | "ready"
  | "close"
  | "negotiate"
  | "payment"
  | "void"
  | "depart"
  | "arrive"
  | null;
type PayMethod = "cash" | "card" | "online";

const STATUS_COLOR: Record<string, string> = {
  open: "#2563eb",
  waiting: "#d97706",
  ready: "#059669",
  closed: "#64748b",
};

export function JobDetailScreen({ route, navigation }: Props) {
  const { id, token } = route.params;
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<Busy>(null);

  // P2e money inputs.
  const [negotiate, setNegotiate] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<PayMethod>("cash");
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const load = useCallback(async () => {
    try {
      setJob(await jobsApi.get(id));
      setError(null);
    } catch {
      setError("Couldn't load this job — check your connection.");
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const submitNote = useCallback(async () => {
    const text = note.trim();
    if (!text || busy) return;
    setBusy("note");
    setError(null);
    try {
      setJob(await jobsApi.addNote(id, text));
      setNote("");
    } catch {
      setError("Couldn't add the note — try again.");
    } finally {
      setBusy(null);
    }
  }, [id, note, busy]);

  const markReady = useCallback(async () => {
    if (busy) return;
    setBusy("ready");
    setError(null);
    try {
      setJob(await jobsApi.transition(id, "ready"));
    } catch {
      setError("Couldn't mark ready — try again.");
    } finally {
      setBusy(null);
    }
  }, [id, busy]);

  // Closing a job requires a closing video (P3c gate). Record it first, upload it
  // (phase=closing, keyed on the token), then transition to close. Capturing the
  // clip reserves a media row, so even a slow upload satisfies the gate.
  const closeWithVideo = useCallback(async () => {
    if (busy) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError("Camera permission is needed to record the closing video.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      quality: 0.85,
      videoMaxDuration: 60,
    });
    if (result.canceled || result.assets.length === 0) return; // aborted → don't close
    const asset = result.assets[0];
    if (!asset) return;
    setBusy("close");
    setError(null);
    try {
      await uploadMedia({
        jobId: String(token),
        phase: "closing",
        type: "video",
        uri: asset.uri,
        filename: asset.fileName ?? `closing-${Date.now()}.mp4`,
        contentType: asset.mimeType ?? "video/mp4",
      });
      setJob(await jobsApi.transition(id, "close"));
    } catch {
      setError("Couldn't close — the closing video didn't upload. Try again.");
    } finally {
      setBusy(null);
    }
  }, [id, token, busy]);

  const negotiateBill = useCallback(async () => {
    const paisa = rupeesToPaisa(negotiate);
    if (paisa <= 0 || busy) return;
    setBusy("negotiate");
    setError(null);
    try {
      setJob(await jobsApi.negotiateBill(id, paisa));
      setNegotiate("");
    } catch {
      setError("Couldn't save the negotiated amount — try again.");
    } finally {
      setBusy(null);
    }
  }, [id, negotiate, busy]);

  const logPayment = useCallback(async () => {
    const paisa = rupeesToPaisa(payAmount);
    if (paisa <= 0 || busy) return;
    setBusy("payment");
    setError(null);
    try {
      // client_id → the backend dedups, so an offline retry never double-charges.
      setJob(await jobsApi.logPayment(id, paisa, payMethod, Crypto.randomUUID()));
      setPayAmount("");
    } catch {
      setError("Couldn't log the payment — try again.");
    } finally {
      setBusy(null);
    }
  }, [id, payAmount, payMethod, busy]);

  const voidPayment = useCallback(
    async (paymentId: string) => {
      const reason = voidReason.trim();
      if (!reason || busy) return;
      setBusy("void");
      setError(null);
      try {
        setJob(await jobsApi.voidPayment(id, paymentId, reason));
        setVoidingId(null);
        setVoidReason("");
      } catch {
        setError("Couldn't void the payment — try again.");
      } finally {
        setBusy(null);
      }
    },
    [id, voidReason, busy],
  );

  const recordPunch = useCallback(
    async (kind: "depart_workshop" | "arrive_customer") => {
      if (busy) return;
      setBusy(kind === "depart_workshop" ? "depart" : "arrive");
      setError(null);
      try {
        const loc = await getLocation();
        if (loc.lat == null || loc.lng == null) {
          setError("Couldn't get your location — enable GPS/location and try again.");
          return;
        }
        // client_id → the backend dedups, so an offline retry never double-records.
        setJob(
          await jobsApi.recordLocation(id, {
            kind,
            lat: loc.lat,
            lng: loc.lng,
            accuracy_m: loc.accuracy_m,
            is_mock: loc.is_mock_location,
            device_time: new Date().toISOString(),
            client_id: Crypto.randomUUID(),
          }),
        );
      } catch {
        setError("Couldn't record the location — try again.");
      } finally {
        setBusy(null);
      }
    },
    [id, busy],
  );

  if (error && !job) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }
  if (!job) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const statusColor = STATUS_COLOR[job.status] ?? "#64748b";
  const canReady = job.status !== "ready" && job.status !== "closed";
  const canClose = job.status !== "closed";
  const open = job.status !== "closed";
  const hasBill = job.bill_original_paisa != null;
  const negotiatePaisa = rupeesToPaisa(negotiate);
  const payPaisa = rupeesToPaisa(payAmount);
  const isVisit = job.job_type === "home-visit";
  const hasDepart = job.locations.some((l) => l.kind === "depart_workshop");
  const hasArrive = job.locations.some((l) => l.kind === "arrive_customer");

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Text style={styles.token}>#{job.token}</Text>
        <View style={[styles.chip, { backgroundColor: statusColor + "1a" }]}>
          <Text style={[styles.chipText, { color: statusColor }]}>{job.status}</Text>
        </View>
      </View>
      <Text style={styles.appliance}>
        {job.appliance_type}
        {job.appliance_brand ? ` · ${job.appliance_brand}` : ""}
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>CUSTOMER</Text>
        <Text style={styles.value}>{job.customer_name}</Text>
        {job.customer_phone ? <Text style={styles.sub}>{job.customer_phone}</Text> : null}
        {job.customer_address ? <Text style={styles.sub}>{job.customer_address}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>PROBLEM</Text>
        <Text style={styles.value}>{job.problem}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>ACTIONS</Text>
        <TextInput
          style={styles.input}
          value={note}
          onChangeText={setNote}
          placeholder="Add a note…"
          multiline
          editable={busy !== "note"}
        />
        <Pressable
          style={[styles.btn, styles.btnDark, (busy === "note" || !note.trim()) && styles.btnBusy]}
          onPress={() => void submitNote()}
          disabled={busy === "note" || !note.trim()}
        >
          <Text style={styles.btnDarkText}>{busy === "note" ? "Adding…" : "Add note"}</Text>
        </Pressable>

        {error ? <Text style={styles.inlineError}>{error}</Text> : null}

        <View style={styles.statusRow}>
          {canReady ? (
            <Pressable
              style={[styles.btn, styles.btnReady, busy === "ready" && styles.btnBusy, styles.grow]}
              onPress={() => void markReady()}
              disabled={!!busy}
            >
              <Text style={styles.btnReadyText}>{busy === "ready" ? "…" : "Mark Ready"}</Text>
            </Pressable>
          ) : null}
          {canClose ? (
            <Pressable
              style={[
                styles.btn,
                styles.btnOutline,
                busy === "close" && styles.btnBusy,
                styles.grow,
              ]}
              onPress={() => void closeWithVideo()}
              disabled={!!busy}
            >
              <Text style={styles.btnOutlineText}>
                {busy === "close" ? "…" : "Close + video"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {isVisit ? (
        <View style={styles.card}>
          <Text style={styles.label}>ROUTE &amp; FUEL</Text>
          {job.route ? (
            <View style={styles.billGrid}>
              <View style={styles.billBox}>
                <Text style={styles.billBoxLabel}>Distance</Text>
                <Text style={styles.billBoxValue}>
                  {(job.route.distance_m / 1000).toFixed(1)} km
                </Text>
              </View>
              <View style={styles.billBox}>
                <Text style={styles.billBoxLabel}>Fuel est.</Text>
                <Text style={styles.billBoxValue}>{formatPaisa(job.route.fuel_paisa)}</Text>
              </View>
            </View>
          ) : (
            <Text style={styles.sub}>Punch both ends to estimate route distance and fuel.</Text>
          )}

          {job.locations.length > 0 ? (
            <View style={styles.pinList}>
              {job.locations.map((loc) => (
                <View key={loc.id} style={styles.event}>
                  <Text style={styles.eventText}>
                    {loc.kind === "depart_workshop" ? "Left workshop" : "Arrived at customer"}
                    {loc.is_mock ? " · ⚠ mock location" : ""}
                  </Text>
                  <Text style={styles.eventTime}>
                    {loc.captured_at.slice(0, 16).replace("T", " ")}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {open ? (
            <View style={styles.statusRow}>
              <Pressable
                style={[
                  styles.btn,
                  styles.btnOutline,
                  styles.grow,
                  busy === "depart" && styles.btnBusy,
                ]}
                onPress={() => void recordPunch("depart_workshop")}
                disabled={!!busy}
              >
                <Text style={styles.btnOutlineText}>
                  {busy === "depart" ? "…" : hasDepart ? "✓ Leaving" : "Leaving workshop"}
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.btn,
                  styles.btnOutline,
                  styles.grow,
                  busy === "arrive" && styles.btnBusy,
                ]}
                onPress={() => void recordPunch("arrive_customer")}
                disabled={!!busy}
              >
                <Text style={styles.btnOutlineText}>
                  {busy === "arrive" ? "…" : hasArrive ? "✓ Arrived" : "Arrived at customer"}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.label}>WORK &amp; BILL</Text>
        {hasBill ? (
          <>
            <View style={styles.billGrid}>
              <View style={styles.billBox}>
                <Text style={styles.billBoxLabel}>Original</Text>
                <Text style={styles.billBoxValue}>{formatPaisa(job.bill_original_paisa)}</Text>
              </View>
              <View style={styles.billBox}>
                <Text style={styles.billBoxLabel}>Negotiated</Text>
                <Text style={styles.billBoxValue}>
                  {job.bill_negotiated_paisa != null ? formatPaisa(job.bill_negotiated_paisa) : "—"}
                </Text>
              </View>
            </View>
            <View style={styles.billGrid}>
              <View style={styles.billBox}>
                <Text style={styles.billBoxLabel}>Received</Text>
                <Text style={styles.billBoxValue}>{formatPaisa(job.received_paisa)}</Text>
              </View>
              <View style={styles.billBox}>
                <Text style={styles.billBoxLabel}>Balance</Text>
                <Text style={styles.billBoxValue}>{formatPaisa(job.balance_paisa)}</Text>
              </View>
            </View>
          </>
        ) : (
          <Text style={styles.sub}>Not completed yet — log materials, time and fuel.</Text>
        )}

        {hasBill && open ? (
          <View style={styles.inlineRow}>
            <TextInput
              style={[styles.input, styles.grow, styles.inlineInput]}
              value={negotiate}
              onChangeText={setNegotiate}
              placeholder="Negotiated Rs"
              keyboardType="number-pad"
              editable={busy !== "negotiate"}
            />
            <Pressable
              style={[
                styles.btn,
                styles.btnDark,
                styles.inlineBtn,
                (busy === "negotiate" || negotiatePaisa <= 0) && styles.btnBusy,
              ]}
              onPress={() => void negotiateBill()}
              disabled={busy === "negotiate" || negotiatePaisa <= 0}
            >
              <Text style={styles.btnDarkText}>{busy === "negotiate" ? "…" : "Save"}</Text>
            </Pressable>
          </View>
        ) : null}

        {open ? (
          <Pressable
            style={styles.completeBtn}
            onPress={() => navigation.navigate("CompleteJob", { id, token })}
          >
            <Text style={styles.completeBtnText}>
              {job.completion ? "Edit completion" : "Complete Job"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {hasBill || job.payments.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.label}>CASH &amp; REVENUE</Text>

          {job.payments.length === 0 ? (
            <Text style={styles.sub}>No payments logged yet.</Text>
          ) : (
            job.payments.map((p) => (
              <View key={p.id} style={styles.payRow}>
                <View style={styles.grow}>
                  <Text style={[styles.payAmt, p.voided && styles.voided]}>
                    {formatPaisa(p.amount_paisa)} · {p.method}
                  </Text>
                  <Text style={styles.eventTime}>
                    {p.recorded_at.slice(0, 10)}
                    {p.voided ? ` · voided${p.void_reason ? ` (${p.void_reason})` : ""}` : ""}
                  </Text>
                </View>
                {!p.voided && open ? (
                  <Pressable
                    onPress={() => {
                      setVoidingId(p.id);
                      setVoidReason("");
                    }}
                    hitSlop={8}
                  >
                    <Text style={styles.correctText}>Correct</Text>
                  </Pressable>
                ) : null}
              </View>
            ))
          )}

          {voidingId ? (
            <View style={styles.voidBox}>
              <TextInput
                style={[styles.input, styles.inlineInput, { marginBottom: 8 }]}
                value={voidReason}
                onChangeText={setVoidReason}
                placeholder="Reason for correction"
                editable={busy !== "void"}
              />
              <View style={styles.statusRow}>
                <Pressable
                  style={[styles.btn, styles.btnOutline, styles.grow]}
                  onPress={() => {
                    setVoidingId(null);
                    setVoidReason("");
                  }}
                >
                  <Text style={styles.btnOutlineText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.btn,
                    styles.btnDanger,
                    styles.grow,
                    (busy === "void" || !voidReason.trim()) && styles.btnBusy,
                  ]}
                  onPress={() => void voidPayment(voidingId)}
                  disabled={busy === "void" || !voidReason.trim()}
                >
                  <Text style={styles.btnDarkText}>{busy === "void" ? "…" : "Void entry"}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {open ? (
            <>
              <View style={styles.methodRow}>
                {(["cash", "card", "online"] as const).map((m) => (
                  <Pressable
                    key={m}
                    style={[styles.methodChip, payMethod === m && styles.methodChipActive]}
                    onPress={() => setPayMethod(m)}
                  >
                    <Text style={[styles.methodText, payMethod === m && styles.methodTextActive]}>
                      {m}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.inlineRow}>
                <TextInput
                  style={[styles.input, styles.grow, styles.inlineInput]}
                  value={payAmount}
                  onChangeText={setPayAmount}
                  placeholder="Amount Rs"
                  keyboardType="number-pad"
                  editable={busy !== "payment"}
                />
                <Pressable
                  style={[
                    styles.btn,
                    styles.btnReady,
                    styles.inlineBtn,
                    (busy === "payment" || payPaisa <= 0) && styles.btnBusy,
                  ]}
                  onPress={() => void logPayment()}
                  disabled={busy === "payment" || payPaisa <= 0}
                >
                  <Text style={styles.btnReadyText}>{busy === "payment" ? "…" : "Log payment"}</Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      ) : null}

      <Text style={styles.sectionHeader}>PHOTOS · BEFORE / AFTER</Text>
      <JobMediaCapture jobKey={String(job.token)} />

      <View style={styles.card}>
        <Text style={styles.label}>TIMELINE</Text>
        {job.events.length === 0 ? (
          <Text style={styles.sub}>No activity yet.</Text>
        ) : (
          [...job.events].reverse().map((e) => (
            <View key={e.id} style={styles.event}>
              <Text style={styles.eventText}>{e.text}</Text>
              <Text style={styles.eventTime}>{e.created_at.slice(0, 10)}</Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8fafc" },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f8fafc" },
  error: { color: "#b91c1c", fontSize: 14, fontWeight: "600" },
  inlineError: { color: "#b91c1c", fontSize: 13, fontWeight: "600", marginTop: 8 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  token: { fontSize: 24, fontWeight: "800", color: "#0f172a" },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  chipText: { fontSize: 12, fontWeight: "800", textTransform: "capitalize" },
  appliance: { fontSize: 13, fontWeight: "600", color: "#64748b", marginTop: 2, marginBottom: 12 },
  card: {
    backgroundColor: "white",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
    marginBottom: 12,
  },
  label: { fontSize: 11, fontWeight: "800", color: "#94a3b8", letterSpacing: 0.5, marginBottom: 4 },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "800",
    color: "#94a3b8",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 2,
  },
  value: { fontSize: 15, fontWeight: "600", color: "#1e293b" },
  sub: { fontSize: 13, color: "#64748b", marginTop: 2 },
  billGrid: { flexDirection: "row", gap: 8, marginTop: 8 },
  billBox: { flex: 1, backgroundColor: "#f8fafc", borderRadius: 8, padding: 10 },
  billBoxLabel: { fontSize: 10, fontWeight: "800", color: "#94a3b8", letterSpacing: 0.5 },
  billBoxValue: { fontSize: 16, fontWeight: "800", color: "#0f172a", marginTop: 2 },
  completeBtn: {
    marginTop: 12,
    backgroundColor: "#059669",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  completeBtnText: { color: "white", fontWeight: "800", fontSize: 15 },
  input: {
    backgroundColor: "#f8fafc",
    borderColor: "#cbd5e1",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 44,
    marginTop: 6,
    marginBottom: 8,
  },
  inlineRow: { flexDirection: "row", gap: 8, marginTop: 10, alignItems: "center" },
  inlineInput: { marginTop: 0, marginBottom: 0 },
  inlineBtn: { justifyContent: "center", paddingHorizontal: 18 },
  btn: { borderRadius: 10, paddingVertical: 11, alignItems: "center" },
  btnBusy: { opacity: 0.5 },
  grow: { flex: 1 },
  btnDark: { backgroundColor: "#0f172a" },
  btnDarkText: { color: "white", fontWeight: "800", fontSize: 14 },
  btnDanger: { backgroundColor: "#b91c1c" },
  statusRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  btnReady: { backgroundColor: "#059669" },
  btnReadyText: { color: "white", fontWeight: "800", fontSize: 14 },
  btnOutline: { backgroundColor: "white", borderWidth: 1, borderColor: "#cbd5e1" },
  btnOutlineText: { color: "#475569", fontWeight: "800", fontSize: 14 },
  payRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
  },
  payAmt: { fontSize: 14, fontWeight: "700", color: "#1e293b" },
  voided: { textDecorationLine: "line-through", color: "#94a3b8" },
  correctText: { color: "#b91c1c", fontWeight: "800", fontSize: 13 },
  voidBox: { marginTop: 10, backgroundColor: "#fef2f2", borderRadius: 8, padding: 10 },
  methodRow: { flexDirection: "row", gap: 8, marginTop: 12, marginBottom: 2 },
  methodChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    alignItems: "center",
    backgroundColor: "white",
  },
  methodChipActive: { backgroundColor: "#0f172a", borderColor: "#0f172a" },
  methodText: { fontSize: 13, fontWeight: "700", color: "#475569", textTransform: "capitalize" },
  methodTextActive: { color: "white" },
  pinList: { marginTop: 8 },
  event: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  eventText: { fontSize: 13, color: "#334155" },
  eventTime: { fontSize: 11, color: "#94a3b8", marginTop: 1 },
});
