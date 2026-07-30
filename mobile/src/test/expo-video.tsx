import { View } from "react-native";

export function VideoView(props: React.ComponentProps<typeof View>) {
  return <View {...props} />;
}

export function useVideoPlayer() {
  return { loop: false };
}
