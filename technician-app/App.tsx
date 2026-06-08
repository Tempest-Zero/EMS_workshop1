import { Feather } from "@expo/vector-icons";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import { ClockScreen } from "./src/features/attendance/ClockScreen";
import { AuthProvider, useAuth } from "./src/features/auth/AuthContext";
import { LoginScreen } from "./src/features/auth/LoginScreen";
import { JobsStack } from "./src/features/jobs/JobsStack";
import { ProfileScreen } from "./src/features/profile/ProfileScreen";
import { useOutboxSync } from "./src/lib/useOutboxSync";

const Tab = createBottomTabNavigator();

const TAB_ICON: Record<string, keyof typeof Feather.glyphMap> = {
  "My Jobs": "clipboard",
  Clock: "clock",
  Profile: "user",
};

// Shown app-wide while job writes (completion / cash / punches) are queued
// offline. Drains automatically on reconnect.
function OfflineBanner({ count }: { count: number }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.banner, { paddingTop: insets.top + 6 }]}>
      <Feather name="wifi-off" size={13} color="#92400e" />
      <Text style={styles.bannerText}>
        {count} change{count === 1 ? "" : "s"} saved offline — syncing when reconnected…
      </Text>
    </View>
  );
}

function Tabs() {
  // Mounted once for the whole authenticated app so the outbox keeps draining
  // even after the tech leaves the screen that queued a write.
  const pending = useOutboxSync();
  return (
    <View style={styles.flex}>
      {pending > 0 ? <OfflineBanner count={pending} /> : null}
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: route.name !== "My Jobs", // the Jobs stack draws its own headers
          tabBarActiveTintColor: "#0f172a",
          tabBarInactiveTintColor: "#94a3b8",
          tabBarIcon: ({ color, size }) => (
            <Feather name={TAB_ICON[route.name] ?? "square"} size={size} color={color} />
          ),
        })}
      >
        <Tab.Screen name="My Jobs" component={JobsStack} />
        <Tab.Screen name="Clock" component={ClockScreen} />
        <Tab.Screen name="Profile" component={ProfileScreen} />
      </Tab.Navigator>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#fef3c7",
    paddingBottom: 6,
    paddingHorizontal: 12,
  },
  bannerText: { color: "#92400e", fontSize: 12, fontWeight: "700" },
});

function Root() {
  const { ready, isAuthenticated } = useAuth();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }
  return isAuthenticated ? <Tabs /> : <LoginScreen />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <NavigationContainer>
          <Root />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
