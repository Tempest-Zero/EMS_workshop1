/**
 * The shared task list. One screen serves four routes — the route name IS the
 * filter (AvailableTasks / OngoingTasks / CompletedTasks / legacy JobsList) —
 * so each category view stays a plain navigation target. Falls back to the
 * offline read cache when the network is away.
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

import { ApiError } from "../../lib/api";
import { jobsApi, type Job } from "../../lib/jobsApi";
import { cacheStamp, loadJobsList, saveJobsList } from "../../lib/jobsCache";
import { useAuth } from "../auth/AuthContext";
import type { JobsStackParamList } from "./types";

type ListRoute = "JobsList" | "AvailableTasks" | "OngoingTasks" | "CompletedTasks";
type Props = NativeStackScreenProps<JobsStackParamList, ListRoute>;

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
        <View
          style={[styles.chip, { backgroundColor: (STATUS_COLOR[job.status] ?? "#64748b") + "1a" }]}
        >
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
        <Pressable
          style={[styles.claimBtn, claiming && styles.claimBtnBusy]}
          onPress={onClaim}
          disabled={claiming}
        >
          <Text style={styles.claimText}>{claiming ? "Claiming…" : "Claim Job"}</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

export function JobsListScreen({ navigation, route }: Props) {
  const { technician } = useAuth();
  const me = technician?.id;
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  const currentRoute = route.name;

  const load = useCallback(async () => {
    try {
      const all = await jobsApi.list();
      setJobs(all);
      setError(null);
      setCachedAt(null);
      void saveJobsList(all);
    } catch {
      const cached = await loadJobsList();
      if (cached) {
        setJobs(cached.data);
        setCachedAt(cached.savedAt);
        setError(null);
      } else {
        setError("Couldn't load jobs — check your connection.");
      }
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

  const claim = async (id: string) => {
    setClaiming(id);
    try {
      await jobsApi.claim(id);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError("Already claimed by another technician — list refreshed.");
        await load();
      } else {
        setError("Couldn't claim that job — try again.");
      }
    } finally {
      setClaiming(null);
    }
  };

  const open = (job: Job) => navigation.navigate("JobDetail", { id: job.id, token: job.token });

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0f172a" />
      </View>
    );
  }

  const available = jobs.filter((j) => !j.assigned_tech_id && j.status !== "closed");
  const ongoing = jobs.filter((j) => j.assigned_tech_id === me && j.status !== "closed");
  const completed = jobs.filter((j) => j.assigned_tech_id === me && j.status === "closed");

  return (
    <View style={styles.container}>
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
        {cachedAt ? (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineText}>
              Offline — showing last synced data ({cacheStamp(cachedAt)}).
            </Text>
          </View>
        ) : null}

        {currentRoute === "AvailableTasks" && (
          <View>
            <Text style={styles.section}>AVAILABLE WORK LIST</Text>
            {available.length === 0 ? (
              <Text style={styles.empty}>No unassigned open tickets right now.</Text>
            ) : (
              available.map((j) => (
                <JobRow
                  key={j.id}
                  job={j}
                  onPress={() => open(j)}
                  onClaim={() => void claim(j.id)}
                  claiming={claiming === j.id}
                />
              ))
            )}
          </View>
        )}

        {currentRoute === "OngoingTasks" && (
          <View>
            <Text style={styles.section}>ACTIVE ON-GOING JOBS</Text>
            {ongoing.length === 0 ? (
              <Text style={styles.empty}>You aren't working on any jobs right now.</Text>
            ) : (
              ongoing.map((j) => <JobRow key={j.id} job={j} onPress={() => open(j)} />)
            )}
          </View>
        )}

        {currentRoute === "CompletedTasks" && (
          <View>
            <Text style={styles.section}>COMPLETED HISTORY ROSTER</Text>
            {completed.length === 0 ? (
              <Text style={styles.empty}>No completed jobs found on your record history.</Text>
            ) : (
              completed.map((j) => <JobRow key={j.id} job={j} onPress={() => open(j)} />)
            )}
          </View>
        )}

        {currentRoute === "JobsList" && (
          <View>
            <Text style={styles.section}>MY ASSIGNED WORK</Text>
            {ongoing.map((j) => (
              <JobRow key={j.id} job={j} onPress={() => open(j)} />
            ))}
          </View>
        )}
      </ScrollView>

      {(currentRoute === "JobsList" || currentRoute === "AvailableTasks") && (
        <Pressable style={styles.fab} onPress={() => navigation.navigate("CreateJob")}>
          <Text style={styles.fabText}>+</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    height: "100%",
    width: "100%",
    backgroundColor: "#f8fafc",
  },
  screen: { flex: 1 },
  content: { padding: 16, paddingBottom: 100 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f8fafc" },
  section: {
    fontSize: 11,
    fontWeight: "800",
    color: "#64748b",
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  empty: { fontSize: 13, color: "#94a3b8", fontStyle: "italic", marginTop: 4, paddingHorizontal: 4 },
  error: { color: "#b91c1c", fontSize: 13, fontWeight: "600", marginBottom: 10 },
  offlineBanner: {
    backgroundColor: "#fef3c7",
    borderColor: "#fde68a",
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  offlineText: { color: "#92400e", fontSize: 12, fontWeight: "700" },
  card: {
    backgroundColor: "white",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
    marginBottom: 12,
  },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  token: { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  chip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  chipText: { fontSize: 11, fontWeight: "800", textTransform: "capitalize" },
  customer: { fontSize: 15, fontWeight: "700", color: "#1e293b", marginTop: 6 },
  appliance: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748b",
    marginTop: 2,
    textTransform: "uppercase",
  },
  problem: { fontSize: 13, color: "#475569", marginTop: 4 },
  claimBtn: {
    marginTop: 12,
    backgroundColor: "#2563eb",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  claimBtnBusy: { opacity: 0.6 },
  claimText: { color: "white", fontWeight: "800", fontSize: 14 },

  fab: {
    position: "absolute",
    bottom: "10%",
    right: "5%",
    backgroundColor: "#0f172a",
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
    elevation: 15,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    zIndex: 9999,
  },
  fabText: {
    color: "white",
    fontSize: 32,
    fontWeight: "300",
    marginTop: -4,
  },
});
