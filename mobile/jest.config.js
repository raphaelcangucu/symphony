module.exports = {
  preset: "jest-expo",
  clearMocks: true,
  setupFilesAfterEnv: ["<rootDir>/src/test/jest-setup.ts"],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(?:-.*)?|@expo/.*|@expo-google-fonts/.*|@noble/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|react-native-markdown-display|@assistant-ui/.*|assistant-cloud|assistant-stream|use-effect-event|nanoid)/)",
  ],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@react-native-async-storage/async-storage$":
      "@react-native-async-storage/async-storage/jest/async-storage-mock",
    "^expo-speech-recognition$": "<rootDir>/src/test/expo-speech-recognition.ts",
    "^expo-video$": "<rootDir>/src/test/expo-video.tsx",
    "^lucide-react-native$": "<rootDir>/src/test/lucide-react-native.tsx",
  },
  testMatch: ["<rootDir>/src/**/*.test.tsx"],
};
