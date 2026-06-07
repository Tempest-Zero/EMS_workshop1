/**
 * Job Detail — customer, appliance, problem, and the live timeline. M3 layers
 * the SOP actions on top (before/after capture bound to the job, notes,
 * mark ready/close).
 */

import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { jobsApi, type JobDetail } from "../../lib/jobsApi";
import type { JobsStackParamList } from "./types";

type Props = NativeStackScreenProps<JobsStackParamList, "JobDetail">;

export function JobDetailScreen({ route }: Props) {
  const { id } = route.params;
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (error) {
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

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.token}>#{job.token}</Text>
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
  token: { fontSize: 24, fontWeight: "800", color: "#0f172a" },
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
  event: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  eventText: { fontSize: 13, color: "#334155" },
  eventTime: { fontSize: 11, color: "#94a3b8", marginTop: 1 },
});
