/**
 * Job Detail — customer, appliance, problem, the live timeline, and the SOP
 * actions a technician drives on-site:
 *   - add a note (Module 3 remarks)
 *   - mark the job Ready / Close it (status transitions)
 * Both call the live backend and re-render from the authoritative JobDetail the
 * endpoint returns (job + timeline), so the timeline reflects the action
 * immediately. Before/after capture bound to the job lands in M3b.
 */

import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
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

import { jobsApi, type JobDetail } from "../../lib/jobsApi";
import type { JobsStackParamList } from "./types";

type Props = NativeStackScreenProps<JobsStackParamList, "JobDetail">;

type Busy = "note" | "ready" | "close" | null;

const STATUS_COLOR: Record<string, string> = {
  open: "#2563eb",
  waiting: "#d97706",
  ready: "#059669",
  closed: "#64748b",
};

export function JobDetailScreen({ route }: Props) {
  const { id } = route.params;
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<Busy>(null);

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

  const transition = useCallback(
    async (action: "ready" | "close") => {
      if (busy) return;
      setBusy(action);
      setError(null);
      try {
        setJob(await jobsApi.transition(id, action));
      } catch {
        setError(`Couldn't ${action === "ready" ? "mark ready" : "close the job"} — try again.`);
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
              onPress={() => void transition("ready")}
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
              onPress={() => void transition("close")}
              disabled={!!busy}
            >
              <Text style={styles.btnOutlineText}>{busy === "close" ? "…" : "Close job"}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

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
  value: { fontSize: 15, fontWeight: "600", color: "#1e293b" },
  sub: { fontSize: 13, color: "#64748b", marginTop: 2 },
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
  btn: { borderRadius: 10, paddingVertical: 11, alignItems: "center" },
  btnBusy: { opacity: 0.5 },
  grow: { flex: 1 },
  btnDark: { backgroundColor: "#0f172a" },
  btnDarkText: { color: "white", fontWeight: "800", fontSize: 14 },
  statusRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  btnReady: { backgroundColor: "#059669" },
  btnReadyText: { color: "white", fontWeight: "800", fontSize: 14 },
  btnOutline: { backgroundColor: "white", borderWidth: 1, borderColor: "#cbd5e1" },
  btnOutlineText: { color: "#475569", fontWeight: "800", fontSize: 14 },
  event: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  eventText: { fontSize: 13, color: "#334155" },
  eventTime: { fontSize: 11, color: "#94a3b8", marginTop: 1 },
});
