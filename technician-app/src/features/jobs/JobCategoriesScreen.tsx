/**
 * The Jobs track's landing hub: three filtered task categories + the intake
 * FAB. Selecting a card opens the shared list screen under that filter
 * (the route name IS the filter — see JobsListScreen).
 */

import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Platform, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";

import type { JobsStackParamList } from "./types";

type Props = NativeStackScreenProps<JobsStackParamList, "JobCategories">;

export function JobCategoriesScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Task Management</Text>
          <Text style={styles.headerSubtitle}>Select a category to view or create jobs</Text>
        </View>

        <View style={styles.cardsContainer}>
          <Pressable
            style={({ pressed }) => [styles.categoryCard, pressed && styles.cardPressed]}
            onPress={() => navigation.navigate("AvailableTasks")}
          >
            <View style={styles.iconBox}>
              <Text style={styles.cardEmoji}>📋</Text>
            </View>
            <View style={styles.cardTextContent}>
              <Text style={styles.cardTitle}>Available Tasks</Text>
              <Text style={styles.cardSubtitle}>Unassigned open tickets</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.categoryCard, pressed && styles.cardPressed]}
            onPress={() => navigation.navigate("OngoingTasks")}
          >
            <View style={styles.iconBox}>
              <Text style={styles.cardEmoji}>🔧</Text>
            </View>
            <View style={styles.cardTextContent}>
              <Text style={styles.cardTitle}>On-Going Tasks</Text>
              <Text style={styles.cardSubtitle}>Your active jobs</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.categoryCard, pressed && styles.cardPressed]}
            onPress={() => navigation.navigate("CompletedTasks")}
          >
            <View style={styles.iconBox}>
              <Text style={styles.cardEmoji}>✅</Text>
            </View>
            <View style={styles.cardTextContent}>
              <Text style={styles.cardTitle}>Completed Tasks</Text>
              <Text style={styles.cardSubtitle}>Your history roster</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </View>

        <Pressable style={styles.fab} onPress={() => navigation.navigate("CreateJob")}>
          <Text style={styles.fabText}>+</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#f8fafc" },
  container: { flex: 1, height: "100%", width: "100%", position: "relative" },

  header: {
    paddingHorizontal: 24,
    paddingTop: Platform.OS === "android" ? 40 : 20,
    paddingBottom: 20,
  },
  headerTitle: { fontSize: 28, fontWeight: "800", color: "#0f172a", letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 15, color: "#64748b", marginTop: 4, fontWeight: "500" },

  cardsContainer: { paddingHorizontal: 16, marginTop: 10, gap: 12 },

  categoryCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "white",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    shadowColor: "#000",
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardPressed: { backgroundColor: "#f1f5f9", borderColor: "#cbd5e1" },

  iconBox: {
    width: 50,
    height: 50,
    borderRadius: 12,
    backgroundColor: "#f8fafc",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
    borderWidth: 1,
    borderColor: "#f1f5f9",
  },
  cardEmoji: { fontSize: 24 },

  cardTextContent: { flex: 1 },
  cardTitle: { fontSize: 17, fontWeight: "700", color: "#1e293b", marginBottom: 4 },
  cardSubtitle: { fontSize: 13, color: "#64748b", fontWeight: "500" },

  chevron: { fontSize: 24, color: "#cbd5e1", fontWeight: "300", paddingLeft: 10 },

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
  fabText: { color: "white", fontSize: 32, fontWeight: "300", marginTop: -4 },
});
