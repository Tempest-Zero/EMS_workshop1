/** Stack for the My Jobs tab: the list → a job's detail. */

import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { JobDetailScreen } from "./JobDetailScreen";
import { JobsListScreen } from "./JobsListScreen";
import type { JobsStackParamList } from "./types";

const Stack = createNativeStackNavigator<JobsStackParamList>();

export function JobsStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="JobsList" component={JobsListScreen} options={{ title: "My Jobs" }} />
      <Stack.Screen
        name="JobDetail"
        component={JobDetailScreen}
        options={({ route }) => ({ title: `Job #${route.params.token}` })}
      />
    </Stack.Navigator>
  );
}
