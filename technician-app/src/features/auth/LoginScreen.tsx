/**
 * Technician login: pick your name from the roster + enter your PIN. Mirrors
 * the manager web login. On success the AuthContext stores the JWT.
 */

import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { authApi, type Technician } from "../../lib/authApi";
import { useAuth } from "./AuthContext";

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function LoginScreen() {
  const { login } = useAuth();
  const [roster, setRoster] = useState<Technician[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authApi
      .roster()
      .then((r) => setRoster(r.filter((t) => t.active && t.role !== "manager")))
      .catch(() => setError("Couldn't load technicians — check your connection."))
      .finally(() => setLoading(false));
  }, []);

  const submit = async () => {
    if (!selected || pin.length < 4) {
      setError("Pick your name and enter your 4-digit PIN.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(selected, pin);
    } catch {
      setError("Wrong PIN, or login failed.");
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.brand}>FixFlow</Text>
      <Text style={styles.subtitle}>Technician sign-in</Text>

      <Text style={styles.label}>WHO ARE YOU?</Text>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 16 }} />
      ) : (
        <View style={styles.roster}>
          {roster.map((t) => {
            const active = selected === t.id;
            return (
              <Pressable
                key={t.id}
                style={[styles.techRow, active && styles.techRowActive]}
                onPress={() => setSelected(t.id)}
              >
                <View style={[styles.avatar, active && styles.avatarActive]}>
                  <Text style={[styles.avatarText, active && styles.avatarTextActive]}>
                    {initials(t.name)}
                  </Text>
                </View>
                <View>
                  <Text style={styles.techName}>{t.name}</Text>
                  {t.specialty ? <Text style={styles.techSpecialty}>{t.specialty}</Text> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      <Text style={[styles.label, { marginTop: 20 }]}>PIN</Text>
      <TextInput
        style={styles.input}
        value={pin}
        onChangeText={setPin}
        placeholder="••••"
        keyboardType="number-pad"
        secureTextEntry
        maxLength={12}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.button, busy && styles.buttonDisabled]}
        onPress={submit}
        disabled={busy}
      >
        <Text style={styles.buttonText}>{busy ? "Signing in…" : "Log in"}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 72, backgroundColor: "#f8fafc", flexGrow: 1 },
  brand: { fontSize: 28, fontWeight: "800", color: "#0f172a" },
  subtitle: { fontSize: 14, fontWeight: "600", color: "#64748b", marginTop: 2, marginBottom: 24 },
  label: { fontSize: 11, fontWeight: "700", color: "#64748b", letterSpacing: 0.5 },
  roster: { marginTop: 10, gap: 8 },
  techRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    padding: 12,
  },
  techRowActive: { borderColor: "#0f172a", backgroundColor: "#0f172a08" },
  avatar: {
    height: 40,
    width: 40,
    borderRadius: 20,
    backgroundColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarActive: { backgroundColor: "#0f172a" },
  avatarText: { fontWeight: "800", color: "#475569" },
  avatarTextActive: { color: "white" },
  techName: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
  techSpecialty: { fontSize: 12, color: "#64748b" },
  input: {
    backgroundColor: "white",
    borderColor: "#cbd5e1",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 18,
    letterSpacing: 4,
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
