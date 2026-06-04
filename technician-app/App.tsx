import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ClockScreen } from "./src/features/attendance/ClockScreen";
import { MediaScreen } from "./src/features/media/MediaScreen";

type Tab = "clock" | "media";

export default function App() {
  const [tab, setTab] = useState<Tab>("clock");
  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <View style={styles.body}>{tab === "clock" ? <ClockScreen /> : <MediaScreen />}</View>
      <View style={styles.tabbar}>
        <TabButton label="Clock" active={tab === "clock"} onPress={() => setTab("clock")} />
        <TabButton label="Media" active={tab === "media"} onPress={() => setTab("media")} />
      </View>
    </View>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.tab} onPress={onPress}>
      <Text style={[styles.tabText, active ? styles.tabTextActive : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f8fafc" },
  body: { flex: 1 },
  tabbar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    backgroundColor: "white",
    paddingBottom: 18,
    paddingTop: 8,
  },
  tab: { flex: 1, alignItems: "center", paddingVertical: 6 },
  tabText: { fontSize: 13, fontWeight: "700", color: "#94a3b8" },
  tabTextActive: { color: "#0f172a" },
});
