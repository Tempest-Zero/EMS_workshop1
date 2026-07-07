import { registerRootComponent } from "expo";

import App from "./App";
// Side-effect imports: register the background TaskManager tasks at JS load,
// BEFORE render, so they're defined even when the OS spins up a headless context
// (a geofence crossing, or an on-duty location ping) while the app is closed.
import "./src/features/attendance/geofence";
import "./src/features/attendance/pingTracker";

registerRootComponent(App);
