export const ExpoSpeechRecognitionModule = {
  isRecognitionAvailable: () => false,
  requestPermissionsAsync: async () => ({ granted: false }),
  addListener: () => ({ remove: () => undefined }),
  start: () => undefined,
  abort: () => undefined,
};
