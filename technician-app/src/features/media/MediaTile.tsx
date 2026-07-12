/**
 * One read-only thumbnail for a captured evidence artefact.
 *
 * Videos play in-place via `expo-video`'s `useVideoPlayer` + `<VideoView>`
 * (the modern API — `expo-av` is deprecated). Photos render via `<Image>`.
 * A pending row (uploaded === false) shows its status as a fallback.
 * Deleting media is the wizard's job (where capture lives), not the tile's.
 */

import { VideoView, useVideoPlayer } from "expo-video";
import { Image, StyleSheet, Text, View } from "react-native";

import type { MediaItem } from "../../lib/api";

interface Props {
  item: MediaItem;
}

export function MediaTile({ item }: Props) {
  const player = useVideoPlayer(item.playback_url ?? "", (p) => {
    p.loop = false;
  });
  const ready = item.status === "uploaded" && item.playback_url;

  return (
    <View style={styles.tile}>
      {ready && item.type === "video" ? (
        <VideoView
          player={player}
          style={styles.media}
          contentFit="cover"
          nativeControls
        />
      ) : ready && item.type === "photo" ? (
        <Image
          source={{ uri: item.playback_url ?? "" }}
          style={styles.media}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.media, styles.pending]}>
          <Text style={styles.pendingText}>{item.status}</Text>
        </View>
      )}
      <View style={styles.typeBadge}>
        <Text style={styles.typeBadgeText}>{item.type}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: 120,
    height: 120,
    marginRight: 8,
    marginBottom: 8,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#0f172a",
    position: "relative",
  },
  media: { width: "100%", height: "100%" },
  pending: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#475569",
  },
  pendingText: {
    color: "white",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  typeBadge: {
    position: "absolute",
    left: 4,
    top: 4,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  typeBadgeText: {
    color: "white",
    fontSize: 9,
    fontWeight: "800",
    textTransform: "uppercase",
  },
});
