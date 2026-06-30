import { registerRootComponent } from "expo";

import App from "./App";
// Side-effect import: registers the background geofence TaskManager task at JS
// load, BEFORE render, so it's defined even when the OS spins up a headless
// context to deliver a geofence crossing while the app is closed.
import "./src/features/attendance/geofence";

registerRootComponent(App);
