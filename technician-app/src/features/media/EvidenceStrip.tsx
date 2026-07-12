/**
 * Read-only strip of a job's captured evidence for the job hub: every phase
 * (before / condition / after / closing) in the order the wizard captures
 * them, each tile captioned with its phase. Capture and delete live in the
 * arrival wizard (the F10 gates) — this is visibility only, so the hub can
 * stay lean without hiding what was recorded.
 *
 * Hides itself entirely while loading, on error (offline), or when the job
 * has no media yet — an empty card would just be noise on the hub.
 */

import { useFocusEffect } from "@react-navigation/native";
import { useCallback } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import type { MediaItem } from "../../lib/api";
import { MediaTile } from "./MediaTile";
import { useMedia } from "./useMedia";

const PHASES = [
  ["before", "Before"],
  ["condition", "Condition"],
  ["after", "After"],
  ["closing", "Closing"],
] as const;

export function EvidenceStrip({ jobKey }: { jobKey: string }) {
  const { list, error, refresh } = useMedia(jobKey);

  // The wizard uploads while this screen sits below it in the stack —
  // refresh whenever the hub regains focus so new captures appear.
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const tiles: { item: MediaItem; phase: string }[] = PHASES.flatMap(([key, label]) =>
    list[key].map((item) => ({ item, phase: label })),
  );
  if (error || tiles.length === 0) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.label}>EVIDENCE</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {tiles.map(({ item, phase }) => (
          <View key={item.id} style={styles.entry}>
            <MediaTile item={item} />
            <Text style={styles.caption}>{phase}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "white",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
    marginBottom: 12,
  },
  label: { fontSize: 11, fontWeight: "800", color: "#94a3b8", letterSpacing: 0.5, marginBottom: 8 },
  entry: { alignItems: "center" },
  caption: { fontSize: 10, fontWeight: "700", color: "#64748b", marginBottom: 4 },
});
