import type { ExpoConfig } from "expo/config";

const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;

const config: ExpoConfig = {
  name: "Dev10x",
  slug: "symphony-mobile",
  version: "0.1.0",
  orientation: "default",
  icon: "./assets/icon.png",
  scheme: "symphony",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  ios: {
    bundleIdentifier: "dev.dev10x.symphony",
    supportsTablet: true,
  },
  android: {
    package: "dev.dev10x.symphony",
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#111111",
    },
  },
  web: {
    bundler: "metro",
    favicon: "./assets/favicon.png",
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-notifications",
    [
      "expo-speech-recognition",
      {
        microphonePermission: "Allow Dev10x to turn your voice into a message.",
        speechRecognitionPermission: "Allow Dev10x to recognize your spoken messages.",
      },
    ],
  ],
  extra: easProjectId ? { eas: { projectId: easProjectId } } : undefined,
  experiments: {
    typedRoutes: true,
  },
};

export default config;
