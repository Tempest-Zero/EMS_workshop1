import { Feather } from "@expo/vector-icons";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ClockScreen } from "./src/features/attendance/ClockScreen";
import { AuthProvider, useAuth } from "./src/features/auth/AuthContext";
import { LoginScreen } from "./src/features/auth/LoginScreen";
import { MyJobsScreen } from "./src/features/jobs/MyJobsScreen";
import { MediaScreen } from "./src/features/media/MediaScreen";
import { ProfileScreen } from "./src/features/profile/ProfileScreen";

const Tab = createBottomTabNavigator();

const TAB_ICON: Record<string, keyof typeof Feather.glyphMap> = {
  "My Jobs": "clipboard",
  Clock: "clock",
  Media: "camera",
  Profile: "user",
};

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarActiveTintColor: "#0f172a",
        tabBarInactiveTintColor: "#94a3b8",
        tabBarIcon: ({ color, size }) => (
          <Feather name={TAB_ICON[route.name] ?? "square"} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="My Jobs" component={MyJobsScreen} />
      <Tab.Screen name="Clock" component={ClockScreen} />
      <Tab.Screen name="Media" component={MediaScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

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
