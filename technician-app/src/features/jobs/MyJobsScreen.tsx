/**
 * My Jobs tab — placeholder shell for M1. M2 fills this with the live jobs
 * list (mine + the unassigned work list) and the claim action.
 */

import { StyleSheet, Text, View } from "react-native";

export function MyJobsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Jobs</Text>
      <Text style={styles.sub}>Your assigned jobs and the work list will appear here.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 40, backgroundColor: "#f8fafc" },
  title: { fontSize: 22, fontWeight: "800", color: "#0f172a" },
  sub: { fontSize: 14, color: "#64748b", marginTop: 6 },
});
