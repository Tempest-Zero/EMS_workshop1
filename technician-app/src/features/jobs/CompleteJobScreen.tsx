/**
 * The technician's post-job work-completion form (Module 3): materials, time
 * on-site, travel/fuel, a text remark, and a voice note. Submitting it
 * (re)generates the original bill on the server. Money is entered in rupees and
 * converted to integer paisa at the boundary.
 */

import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { jobsApi, type Material } from "../../lib/jobsApi";
import { formatPaisa, rupeesToPaisa } from "../../lib/money";
import { makeItem } from "../../lib/outbox";
import { sendOrQueue } from "../../lib/outboxSync";
import { uploadMedia } from "../media/uploadMedia";
import { VoiceNote } from "./VoiceNote";
import type { JobsStackParamList } from "./types";

type Props = NativeStackScreenProps<JobsStackParamList, "CompleteJob">;

const LABOUR_RATE_PAISA = 120000; // Rs 1200/hr — matches the backend default (preview only)

interface MaterialRow {
  name: string;
  qty: string;
  unitRs: string;
}

export function CompleteJobScreen({ route, navigation }: Props) {
  const { id, token } = route.params;
  const [materials, setMaterials] = useState<MaterialRow[]>([{ name: "", qty: "1", unitRs: "" }]);
  const [timeMins, setTimeMins] = useState("");
  const [fuelRs, setFuelRs] = useState("");
  const [remarks, setRemarks] = useState("");
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setRow = (i: number, key: keyof MaterialRow, val: string) =>
    setMaterials((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));
  const addRow = () => setMaterials((rows) => [...rows, { name: "", qty: "1", unitRs: "" }]);
  const removeRow = (i: number) => setMaterials((rows) => rows.filter((_, idx) => idx !== i));

  const cleanMaterials: Material[] = materials
    .filter((m) => m.name.trim() && rupeesToPaisa(m.unitRs) > 0)
    .map((m) => ({
      name: m.name.trim(),
      qty: Math.max(1, parseInt(m.qty, 10) || 1),
      unit_paisa: rupeesToPaisa(m.unitRs),
    }));

  const materialsPaisa = cleanMaterials.reduce((s, m) => s + m.qty * m.unit_paisa, 0);
  const timeSpentMins = parseInt(timeMins, 10) || 0;
  const labourPaisa = Math.round((timeSpentMins / 60) * LABOUR_RATE_PAISA);
  const fuelPaisa = rupeesToPaisa(fuelRs);
  const billPaisa = materialsPaisa + labourPaisa + fuelPaisa;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      // Upload the voice note (best-effort) → link its media id.
      let audioId: string | undefined;
      if (audioUri) {
        try {
          const m = await uploadMedia({
            jobId: String(token),
            phase: "remark",
            type: "audio",
            uri: audioUri,
            // .m4a / AAC served as audio/mp4 — the MIME desktop browsers accept on
            // <audio> (audio/x-m4a is rejected by Safari). Matches VoiceNote's encoder.
            filename: "remark.m4a",
            contentType: "audio/mp4",
          });
          audioId = m.id;
        } catch {
          // Non-fatal: submit the form with the text remark; the audio can be
          // re-attached later. (Offline-friendly.)
        }
      }
      const body = {
        materials: cleanMaterials,
        time_spent_mins: timeSpentMins,
        fuel_paisa: fuelPaisa,
        remarks_text: remarks.trim() || undefined,
        remarks_audio_media_id: audioId,
      };
      // Offline-capable: online submits now, offline queues (idempotent upsert)
      // and syncs on reconnect — the "form submission must work offline" rule.
      const detail = await sendOrQueue(
        makeItem({
          id: `completion:${id}`,
          kind: "completion",
          jobId: id,
          payload: { body },
        }),
        () => jobsApi.submitCompletion(id, body),
      );
      if (!detail) {
        Alert.alert("Saved offline", "The completion will submit when you reconnect.");
      }
      navigation.goBack();
    } catch {
      setError("Couldn't submit — check your connection and try again.");
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.section}>MATERIALS USED</Text>
      {materials.map((m, i) => (
        <View key={i} style={styles.matCard}>
          <TextInput
            style={styles.input}
            value={m.name}
            onChangeText={(v) => setRow(i, "name", v)}
            placeholder="Part / material"
          />
          <View style={styles.matRow}>
            <TextInput
              style={[styles.input, styles.small]}
              value={m.qty}
              onChangeText={(v) => setRow(i, "qty", v)}
              placeholder="Qty"
              keyboardType="number-pad"
            />
            <TextInput
              style={[styles.input, styles.grow]}
              value={m.unitRs}
              onChangeText={(v) => setRow(i, "unitRs", v)}
              placeholder="Unit Rs"
              keyboardType="number-pad"
            />
            {materials.length > 1 ? (
              <Pressable onPress={() => removeRow(i)} style={styles.remove}>
                <Text style={styles.removeText}>✕</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ))}
      <Pressable style={styles.addBtn} onPress={addRow}>
        <Text style={styles.addText}>+ Add material</Text>
      </Pressable>

      <View style={styles.row2}>
        <View style={styles.grow}>
          <Text style={styles.section}>TIME ON-SITE (MIN)</Text>
          <TextInput
            style={styles.input}
            value={timeMins}
            onChangeText={setTimeMins}
            placeholder="0"
            keyboardType="number-pad"
          />
        </View>
        <View style={styles.grow}>
          <Text style={styles.section}>TRAVEL / FUEL (RS)</Text>
          <TextInput
            style={styles.input}
            value={fuelRs}
            onChangeText={setFuelRs}
            placeholder="0"
            keyboardType="number-pad"
          />
        </View>
      </View>

      <Text style={styles.section}>REMARKS</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={remarks}
        onChangeText={setRemarks}
        placeholder="What was done / advice given"
        multiline
      />

      <Text style={styles.section}>VOICE NOTE</Text>
      <VoiceNote uri={audioUri} onChange={setAudioUri} />

      <View style={styles.billCard}>
        <Text style={styles.billLabel}>Bill (auto)</Text>
        <Text style={styles.billValue}>{formatPaisa(billPaisa)}</Text>
      </View>

      {error ? <Text style={styles.err}>{error}</Text> : null}

      <Pressable style={[styles.submit, busy && styles.busy]} onPress={() => void submit()} disabled={busy}>
        {busy ? <ActivityIndicator color="white" /> : <Text style={styles.submitText}>Submit Completion</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8fafc" },
  content: { padding: 16, paddingBottom: 48 },
  section: { fontSize: 11, fontWeight: "800", color: "#64748b", letterSpacing: 0.5, marginTop: 14, marginBottom: 6 },
  matCard: { backgroundColor: "white", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, padding: 10, marginBottom: 8 },
  matRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  input: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  multiline: { minHeight: 64, textAlignVertical: "top" },
  small: { width: 64 },
  grow: { flex: 1 },
  remove: { padding: 8 },
  removeText: { color: "#b91c1c", fontWeight: "800", fontSize: 16 },
  addBtn: { paddingVertical: 8 },
  addText: { color: "#2563eb", fontWeight: "800", fontSize: 14 },
  row2: { flexDirection: "row", gap: 12 },
  billCard: {
    marginTop: 18,
    backgroundColor: "#0f172a",
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  billLabel: { color: "#94a3b8", fontWeight: "700", fontSize: 13 },
  billValue: { color: "white", fontWeight: "800", fontSize: 20 },
  err: { color: "#b91c1c", fontSize: 13, fontWeight: "600", marginTop: 12 },
  submit: { marginTop: 16, backgroundColor: "#059669", borderRadius: 12, paddingVertical: 15, alignItems: "center" },
  busy: { opacity: 0.7 },
  submitText: { color: "white", fontWeight: "800", fontSize: 16 },
});
