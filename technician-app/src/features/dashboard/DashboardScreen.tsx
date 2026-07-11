/**
 * The Central Hub — first screen after login. The old bottom tabs became
 * three cards (Jobs / Attendance / Profile); the duty badge is live server
 * truth (attendance `today`), not decoration, so a tech who forgot to clock
 * in sees it before opening a single job.
 */

import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useState } from "react";
import { Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from "react-native";

import { attendanceApi } from "../../lib/attendanceApi";
import type { RootStackParamList } from "../../lib/navigation";
import { useAuth } from "../auth/AuthContext";

type Props = NativeStackScreenProps<RootStackParamList, "DashboardHub">;

export function DashboardScreen({ navigation }: Props) {
  const { technician } = useAuth();
  const technicianName = technician?.name ?? "Technician";

  // null = unknown (offline / still loading) → the badge stays neutral rather
  // than claiming a duty state we can't back up.
  const [clockedIn, setClockedIn] = useState<boolean | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (technician) {
        attendanceApi
          .today(technician.id)
          .then((t) => {
            if (!cancelled) setClockedIn(t.clocked_in);
          })
          .catch(() => {
            if (!cancelled) setClockedIn(null);
          });
      }
      return () => {
        cancelled = true;
      };
    }, [technician]),
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />

      <View style={styles.header}>
        <Text style={styles.welcomeText}>Welcome back,</Text>
        <Text style={styles.techName}>{technicianName}</Text>
        {clockedIn !== null ? (
          <View style={[styles.statusBadge, !clockedIn && styles.statusBadgeOff]}>
            <View style={[styles.statusDot, !clockedIn && styles.statusDotOff]} />
            <Text style={[styles.statusText, !clockedIn && styles.statusTextOff]}>
              {clockedIn ? "On Duty" : "Off Duty"}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.menuGrid}>
        <Pressable
          style={({ pressed }) => [styles.menuCard, pressed && styles.cardPressed]}
          onPress={() => navigation.navigate("My Jobs")}
        >
          <View style={[styles.iconWrapper, { backgroundColor: "rgba(59, 130, 246, 0.1)" }]}>
            <Text style={styles.iconPlaceholder}>💼</Text>
          </View>
          <View style={styles.cardContent}>
            <Text style={styles.cardTitle}>Jobs</Text>
            <Text style={styles.cardSubtitle}>Manage active orders & diagnostic assignments</Text>
          </View>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.menuCard, pressed && styles.cardPressed]}
          onPress={() => navigation.navigate("Clock")}
        >
          <View style={[styles.iconWrapper, { backgroundColor: "rgba(16, 185, 129, 0.1)" }]}>
            <Text style={styles.iconPlaceholder}>⏰</Text>
          </View>
          <View style={styles.cardContent}>
            <Text style={styles.cardTitle}>Attendance</Text>
            <Text style={styles.cardSubtitle}>Clock in/out or view daily workshop hours</Text>
          </View>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.menuCard, pressed && styles.cardPressed]}
          onPress={() => navigation.navigate("Profile")}
        >
          <View style={[styles.iconWrapper, { backgroundColor: "rgba(99, 102, 241, 0.1)" }]}>
            <Text style={styles.iconPlaceholder}>👤</Text>
          </View>
          <View style={styles.cardContent}>
            <Text style={styles.cardTitle}>Profile</Text>
            <Text style={styles.cardSubtitle}>View workspace specialties and configurations</Text>
          </View>
        </Pressable>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerBrand}>FixFlow Technician v0.1.0</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 30,
    paddingBottom: 10,
  },
  welcomeText: {
    fontSize: 16,
    color: "#64748b",
    fontWeight: "500",
  },
  techName: {
    fontSize: 28,
    fontWeight: "700",
    color: "#0f172a",
    marginTop: 4,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ecfdf5",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    marginTop: 12,
  },
  statusBadgeOff: { backgroundColor: "#f1f5f9" },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#10b981",
    marginRight: 6,
  },
  statusDotOff: { backgroundColor: "#94a3b8" },
  statusText: {
    color: "#10b981",
    fontSize: 12,
    fontWeight: "600",
  },
  statusTextOff: { color: "#64748b" },
  menuGrid: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 20,
  },
  menuCard: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderRadius: 16,
    paddingVertical: 24,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  cardPressed: {
    backgroundColor: "#f8fafc",
    transform: [{ scale: 0.98 }],
  },
  iconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  iconPlaceholder: {
    fontSize: 22,
  },
  cardContent: {
    alignItems: "center",
    marginTop: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#0f172a",
    textAlign: "center",
  },
  cardSubtitle: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 4,
    lineHeight: 16,
    textAlign: "center",
  },
  footer: {
    alignItems: "center",
    paddingBottom: 20,
  },
  footerBrand: {
    fontSize: 12,
    color: "#94a3b8",
    fontWeight: "500",
    letterSpacing: 0.5,
  },
});
