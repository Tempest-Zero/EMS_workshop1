/** Stack for the Jobs track: categories hub → filtered lists → a job's detail. */
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { CompleteJobScreen } from "./CompleteJobScreen";
import { CreateJobWizard } from "./create-job/CreateJobWizard";
import { JobCategoriesScreen } from "./JobCategoriesScreen";
import { JobDetailScreen } from "./JobDetailScreen";
import { JobsListScreen } from "./JobsListScreen";
import { TravelScreen } from "./TravelScreen";
import type { JobsStackParamList } from "./types";

const Stack = createNativeStackNavigator<JobsStackParamList>();

export function JobsStack() {
  return (
    <Stack.Navigator initialRouteName="JobCategories">
      {/* 1. The categories hub (first screen of the track) */}
      <Stack.Screen
        name="JobCategories"
        component={JobCategoriesScreen}
        options={{ headerShown: false }}
      />

      {/* 2. Three filtered views over the same list screen (route = filter) */}
      <Stack.Screen
        name="AvailableTasks"
        component={JobsListScreen}
        options={{ title: "Available Tasks" }}
      />
      <Stack.Screen
        name="OngoingTasks"
        component={JobsListScreen}
        options={{ title: "On-Going Tasks" }}
      />
      <Stack.Screen
        name="CompletedTasks"
        component={JobsListScreen}
        options={{ title: "Completed Tasks" }}
      />

      {/* 3. Legacy flat list, kept as a fallback route */}
      <Stack.Screen name="JobsList" component={JobsListScreen} options={{ title: "My Jobs" }} />

      <Stack.Screen
        name="JobDetail"
        component={JobDetailScreen}
        options={({ route }) => ({ title: `Job #${route.params.token}` })}
      />
      <Stack.Screen
        name="CompleteJob"
        component={CompleteJobScreen}
        options={({ route }) => ({ title: `Complete #${route.params.token}` })}
      />

      {/* 4. Intake wizard + travel flow */}
      <Stack.Screen name="CreateJob" component={CreateJobWizard} options={{ headerShown: false }} />
      <Stack.Screen name="Travel" component={TravelScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}
