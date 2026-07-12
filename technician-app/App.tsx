import { Feather } from "@expo/vector-icons";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, AppState, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import { ClockScreen } from "./src/features/attendance/ClockScreen";
import { useAttendanceBackground } from "./src/features/attendance/useAttendanceBackground";
import { AuthProvider, useAuth } from "./src/features/auth/AuthContext";
import { LoginScreen } from "./src/features/auth/LoginScreen";
import { DashboardScreen } from "./src/features/dashboard/DashboardScreen";
import { ArrivalJobBillScreen } from "./src/features/jobs/arrival-job/ArrivalJobBillScreen";
import { ArrivalJobWizard } from "./src/features/jobs/arrival-job/ArrivalJobWizard";
import { JobsStack } from "./src/features/jobs/JobsStack";
import { syncTravelSamples } from "./src/features/jobs/travelSync";
import { ensureTravelTracking } from "./src/features/jobs/travelTracker";
import { usePendingMediaDrain } from "./src/features/media/usePendingMediaDrain";
import { OnboardingScreen } from "./src/features/onboarding/OnboardingScreen";
import { isOnboarded } from "./src/features/onboarding/permissions";
import { ProfileScreen } from "./src/features/profile/ProfileScreen";
import { navigationRef, type RootStackParamList } from "./src/lib/navigation";
import { initSentry } from "./src/lib/sentry";
import { useOutboxSync } from "./src/lib/useOutboxSync";
import { usePushRegistration } from "./src/lib/usePushRegistration";

initSentry();

const Stack = createNativeStackNavigator<RootStackParamList>();

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

// The authed app: a native stack rooted at the Dashboard hub (the old bottom
// tabs became hub cards). The arrival wizard + bill sheet are root-level
// modals so the travel flow and the jobs stack can both open them.
function AuthedStack() {
  // Mounted once for the whole authenticated app so the outbox keeps draining
  // even after the tech leaves the screen that queued a write.
  const { queued, failed } = useOutboxSync();
  const { technician } = useAuth();
  usePushRegistration();
  useAttendanceBackground();
  usePendingMediaDrain();

  // Travel breadcrumbs: reconcile the OS task on launch/foreground (re-arm
  // after an app kill, stop an expired/orphaned session) and drain the queue.
  useEffect(() => {
    void ensureTravelTracking();
    if (technician) void syncTravelSamples(technician.id);
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") {
        void ensureTravelTracking();
        if (technician) void syncTravelSamples(technician.id);
      }
    });
    return () => sub.remove();
  }, [technician]);

  return (
    <View style={styles.flex}>
      {queued > 0 || failed > 0 ? <OfflineBanner queued={queued} failed={failed} /> : null}
      <Stack.Navigator
        initialRouteName="DashboardHub"
        screenOptions={{
          headerStyle: { backgroundColor: "#1e293b" },
          headerTintColor: "#ffffff",
          headerTitleStyle: { fontWeight: "600" },
        }}
      >
        <Stack.Screen
          name="DashboardHub"
          component={DashboardScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen name="My Jobs" component={JobsStack} options={{ headerShown: false }} />
        <Stack.Screen name="Clock" component={ClockScreen} options={{ title: "Attendance" }} />
        <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profile" }} />
        <Stack.Screen
          name="ArrivalWizard"
          component={ArrivalJobWizard}
          options={{ headerShown: false, presentation: "modal" }}
        />
        <Stack.Screen
          name="BillSheet"
          component={ArrivalJobBillScreen}
          options={{ headerShown: false }}
        />
      </Stack.Navigator>
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
  return <AuthedStack />;
}

function Root() {
  const { ready, isAuthenticated } = useAuth();
  if (!ready) return <Spinner />;
  return isAuthenticated ? <AuthedApp /> : <LoginScreen />;
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
