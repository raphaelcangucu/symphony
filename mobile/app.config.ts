import type { ExpoConfig } from "expo/config";

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
  plugins: ["expo-router", "expo-secure-store"],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
