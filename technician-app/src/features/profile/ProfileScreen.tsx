/** Profile tab: who's logged in + log out. */

import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "../auth/AuthContext";

export function ProfileScreen() {
  const { technician, logout } = useAuth();
  return (
    <View style={styles.container}>
      <Text style={styles.name}>{technician?.name ?? "Technician"}</Text>
      <Text style={styles.specialty}>{technician?.specialty ?? technician?.role ?? ""}</Text>

      <Pressable style={styles.button} onPress={() => void logout()}>
        <Text style={styles.buttonText}>Log out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 40, backgroundColor: "#f8fafc" },
  name: { fontSize: 22, fontWeight: "800", color: "#0f172a" },
  specialty: { fontSize: 14, color: "#64748b", marginTop: 2 },
  button: {
    marginTop: 28,
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonText: { color: "#b91c1c", fontWeight: "800", fontSize: 15 },
});
