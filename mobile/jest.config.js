module.exports = {
  preset: "jest-expo",
  clearMocks: true,
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@react-native-async-storage/async-storage$":
      "@react-native-async-storage/async-storage/jest/async-storage-mock",
    "^expo-speech-recognition$": "<rootDir>/src/test/expo-speech-recognition.ts",
    "^lucide-react-native$": "<rootDir>/src/test/lucide-react-native.tsx",
  },
  testMatch: ["<rootDir>/src/**/*.test.tsx"],
};
