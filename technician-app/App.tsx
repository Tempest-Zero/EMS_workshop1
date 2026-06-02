import { StatusBar } from "expo-status-bar";

import { MediaScreen } from "./src/features/media/MediaScreen";

export default function App() {
  return (
    <>
      <StatusBar style="dark" />
      <MediaScreen />
    </>
  );
}
