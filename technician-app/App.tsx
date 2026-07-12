import { Feather } from "@expo/vector-icons";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import { ClockScreen } from "./src/features/attendance/ClockScreen";
import { useAttendanceBackground } from "./src/features/attendance/useAttendanceBackground";
import { AuthProvider, useAuth } from "./src/features/auth/AuthContext";
import { LoginScreen } from "./src/features/auth/LoginScreen";
import { ForceChangePasswordScreen } from "./src/features/auth/ForceChangePasswordScreen";
import { JobsStack } from "./src/features/jobs/JobsStack";
import { OnboardingScreen } from "./src/features/onboarding/OnboardingScreen";
import { isOnboarded } from "./src/features/onboarding/permissions";
import { ProfileScreen } from "./src/features/profile/ProfileScreen";
import { navigationRef } from "./src/lib/navigation";
import { initSentry } from "./src/lib/sentry";
import { useOutboxSync } from "./src/lib/useOutboxSync";
import { usePushRegistration } from "./src/lib/usePushRegistration";

initSentry();

const Tab = createBottomTabNavigator();

const TAB_ICON: Record<string, keyof typeof Feather.glyphMap> = {
  "My Jobs": "clipboard",
  Clock: "clock",
  Profile: "user",
};

// Shown app-wide while job writes (completion / cash / punches) are queued
// offline (amber) or were rejected and need the technician's decision (red —
// the failed items live on each job's detail screen with Retry / Discard).
function OfflineBanner({ queued, failed }: { queued: number; failed: number }) {
  const insets = useSafeAreaInsets();
  const hasFailed = failed > 0;
  return (
    <View
      style={[styles.banner, hasFailed && styles.bannerFailed, { paddingTop: insets.top + 6 }]}
    >
      <Feather name={hasFailed ? "alert-triangle" : "wifi-off"} size={13} color={hasFailed ? "#b91c1c" : "#92400e"} />
      <Text style={[styles.bannerText, hasFailed && styles.bannerTextFailed]}>
        {hasFailed
          ? `${failed} change${failed === 1 ? "" : "s"} need attention (see the job) · ${queued} syncing`
          : `${queued} change${queued === 1 ? "" : "s"} saved offline — syncing when reconnected…`}
      </Text>
    </View>
  );
}

function Tabs() {
  // Mounted once for the whole authenticated app so the outbox keeps draining
  // even after the tech leaves the screen that queued a write.
  const { queued, failed } = useOutboxSync();
  usePushRegistration();
  useAttendanceBackground();
  return (
    <View style={styles.flex}>
      {queued > 0 || failed > 0 ? <OfflineBanner queued={queued} failed={failed} /> : null}
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
  bannerFailed: { backgroundColor: "#fee2e2" },
  bannerTextFailed: { color: "#b91c1c" },
});

function Spinner() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator />
    </View>
  );
}

// Authenticated: show the one-time attendance onboarding before the app proper,
// so the background-location grant is asked for with its "why" already on screen.
function AuthedApp() {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  useEffect(() => {
    void isOnboarded().then(setOnboarded);
  }, []);
  if (onboarded === null) return <Spinner />;
  if (!onboarded) return <OnboardingScreen onDone={() => setOnboarded(true)} />;
  return <Tabs />;
}

function Root() {
  const { ready, isAuthenticated, needsPasswordChange } = useAuth();
  if (!ready) return <Spinner />;
  if (isAuthenticated) {
    if (needsPasswordChange) return <ForceChangePasswordScreen />;
    return <AuthedApp />;
  }
  return <LoginScreen />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <NavigationContainer ref={navigationRef}>
          <Root />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
