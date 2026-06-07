/**
 * Standalone Media tab: a free-text Job ID + the Before/After capture for it.
 * The job-id input lets the demo drive any job created in the manager web app.
 * Job-bound capture (no typing) lives in Job Detail, which renders the same
 * `JobMediaCapture` keyed on the job's token.
 */

import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { JobMediaCapture } from "./JobMediaCapture";

const DEFAULT_JOB = "demo-job";

export function MediaScreen() {
  const [jobId, setJobId] = useState(DEFAULT_JOB);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.h1}>FixFlow · Technician</Text>
      <Text style={styles.h2}>Before / After capture</Text>

      <View style={styles.jobBox}>
        <Text style={styles.label}>Job ID</Text>
        <TextInput
          style={styles.input}
          value={jobId}
          onChangeText={setJobId}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="demo-job"
        />
      </View>

      <JobMediaCapture jobKey={jobId} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingTop: 48, paddingBottom: 64, backgroundColor: "#f8fafc", flexGrow: 1 },
  h1: { fontSize: 22, fontWeight: "800", color: "#0f172a" },
  h2: { fontSize: 14, fontWeight: "600", color: "#475569", marginTop: 2 },
  jobBox: { marginTop: 16, marginBottom: 16 },
  label: { fontSize: 11, fontWeight: "700", color: "#64748b", textTransform: "uppercase", marginBottom: 4 },
  input: {
    backgroundColor: "white",
    borderColor: "#cbd5e1",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
});
