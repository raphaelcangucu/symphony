module.exports = {
  preset: "jest-expo",
  clearMocks: true,
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^lucide-react-native$": "<rootDir>/src/test/lucide-react-native.tsx",
  },
  testMatch: ["<rootDir>/src/**/*.test.tsx"],
};
