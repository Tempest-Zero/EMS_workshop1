/**
 * My Jobs + the unassigned Work List. The technician sees jobs assigned to
 * them, and can Claim (free-pick) anything from the work list.
 */

import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { jobsApi, type Job } from "../../lib/jobsApi";
import { useAuth } from "../auth/AuthContext";
import type { JobsStackParamList } from "./types";

type Props = NativeStackScreenProps<JobsStackParamList, "JobsList">;

const STATUS_COLOR: Record<string, string> = {
  open: "#2563eb",
  waiting: "#d97706",
  ready: "#059669",
  closed: "#64748b",
};

function JobRow({
  job,
  onPress,
  onClaim,
  claiming,
}: {
  job: Job;
  onPress: () => void;
  onClaim?: () => void;
  claiming?: boolean;
}) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.cardTop}>
        <Text style={styles.token}>#{job.token}</Text>
        <View style={[styles.chip, { backgroundColor: (STATUS_COLOR[job.status] ?? "#64748b") + "1a" }]}>
          <Text style={[styles.chipText, { color: STATUS_COLOR[job.status] ?? "#64748b" }]}>
            {job.status}
          </Text>
        </View>
      </View>
      <Text style={styles.customer}>{job.customer_name}</Text>
      <Text style={styles.appliance}>
        {job.appliance_type}
        {job.appliance_brand ? ` · ${job.appliance_brand}` : ""}
      </Text>
      <Text style={styles.problem} numberOfLines={2}>
        {job.problem}
      </Text>
      {onClaim ? (
        <Pressable style={[styles.claimBtn, claiming && styles.claimBtnBusy]} onPress={onClaim} disabled={claiming}>
          <Text style={styles.claimText}>{claiming ? "Claiming…" : "Claim"}</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

export function JobsListScreen({ navigation }: Props) {
  const { technician } = useAuth();
  const me = technician?.id;
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await jobsApi.list();
      setJobs(all);
      setError(null);
    } catch {
      setError("Couldn't load jobs — check your connection.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const mine = jobs.filter((j) => j.assigned_tech_id === me && j.status !== "closed");
  const workList = jobs.filter((j) => !j.assigned_tech_id && j.status !== "closed");

  const claim = async (id: string) => {
    setClaiming(id);
    try {
      await jobsApi.claim(id);
      await load();
    } catch {
      setError("Couldn't claim that job — try again.");
    } finally {
      setClaiming(null);
    }
  };

  const open = (job: Job) => navigation.navigate("JobDetail", { id: job.id, token: job.token });

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
        />
      }
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.section}>MY JOBS</Text>
      {mine.length === 0 ? (
        <Text style={styles.empty}>No jobs assigned to you. Claim one from the work list below.</Text>
      ) : (
        mine.map((j) => <JobRow key={j.id} job={j} onPress={() => open(j)} />)
      )}

      <Text style={[styles.section, { marginTop: 20 }]}>WORK LIST · UNASSIGNED</Text>
      {workList.length === 0 ? (
        <Text style={styles.empty}>Nothing waiting to be picked up.</Text>
      ) : (
        workList.map((j) => (
          <JobRow
            key={j.id}
            job={j}
            onPress={() => open(j)}
            onClaim={() => void claim(j.id)}
            claiming={claiming === j.id}
          />
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8fafc" },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f8fafc" },
  section: { fontSize: 11, fontWeight: "800", color: "#64748b", letterSpacing: 0.5, marginBottom: 8 },
  empty: { fontSize: 13, color: "#94a3b8", fontStyle: "italic" },
  error: { color: "#b91c1c", fontSize: 13, fontWeight: "600", marginBottom: 10 },
  card: {
    backgroundColor: "white",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
    marginBottom: 10,
  },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  token: { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  chip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  chipText: { fontSize: 11, fontWeight: "800", textTransform: "capitalize" },
  customer: { fontSize: 15, fontWeight: "700", color: "#1e293b", marginTop: 6 },
  appliance: { fontSize: 12, fontWeight: "600", color: "#64748b", marginTop: 2, textTransform: "uppercase" },
  problem: { fontSize: 13, color: "#475569", marginTop: 4 },
  claimBtn: {
    marginTop: 10,
    backgroundColor: "#0f172a",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  claimBtnBusy: { opacity: 0.6 },
  claimText: { color: "white", fontWeight: "800", fontSize: 14 },
});
