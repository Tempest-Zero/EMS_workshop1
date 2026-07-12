import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from "react-native";
import { authApi } from "../../lib/authApi";
import { useAuth } from "./AuthContext";

export function ForceChangePasswordScreen() {
  const { refreshUser } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authApi.changePassword(password);
      await refreshUser();
    } catch (err: any) {
      setError(err.message || "Failed to update password. Ensure it meets complexity requirements.");
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.brand}>FixFlow</Text>
      <Text style={styles.subtitle}>Security Update Required</Text>
      <Text style={styles.info}>Please set a new password to continue.</Text>

      <Text style={[styles.label, { marginTop: 20 }]}>NEW PASSWORD</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        placeholder="••••••••"
        secureTextEntry
      />

      <Text style={[styles.label, { marginTop: 20 }]}>CONFIRM PASSWORD</Text>
      <TextInput
        style={styles.input}
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        placeholder="••••••••"
        secureTextEntry
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.button, (busy || !password || !confirmPassword) && styles.buttonDisabled]}
        onPress={submit}
        disabled={busy || !password || !confirmPassword}
      >
        {busy ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Update Password</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 72, backgroundColor: "#f8fafc", flexGrow: 1 },
  brand: { fontSize: 28, fontWeight: "800", color: "#0f172a" },
  subtitle: { fontSize: 18, fontWeight: "700", color: "#d97706", marginTop: 2 },
  info: { fontSize: 14, color: "#64748b", marginTop: 8, marginBottom: 16 },
  label: { fontSize: 11, fontWeight: "700", color: "#64748b", letterSpacing: 0.5 },
  input: {
    backgroundColor: "white",
    borderColor: "#cbd5e1",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginTop: 8,
  },
  error: { color: "#b91c1c", fontSize: 13, fontWeight: "600", marginTop: 12 },
  button: {
    backgroundColor: "#0f172a",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 20,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "white", fontWeight: "800", fontSize: 16 },
});
