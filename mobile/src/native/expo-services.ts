import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";
import { Platform } from "react-native";

import { captureDictation, startDictation, type DictationPort, type DictationSession } from "./dictation";
import {
  createNotificationRouter,
  loadOrCreateDeviceId,
  type NativeNotificationService,
  type NotificationPermission,
} from "./notifications";

const dictationPort: DictationPort = {
  available: () => ExpoSpeechRecognitionModule.isRecognitionAvailable(),
  async requestPermission() {
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return permission.granted;
  },
  addListener: (event, listener) =>
    ExpoSpeechRecognitionModule.addListener(event, listener as never),
  start: (options) => ExpoSpeechRecognitionModule.start(options),
  stop: () => ExpoSpeechRecognitionModule.stop(),
  abort: () => ExpoSpeechRecognitionModule.abort(),
};

export function dictateWithExpo(lang: string): Promise<string> {
  return captureDictation(dictationPort, lang);
}

export function startDictationWithExpo(lang: string): Promise<DictationSession> {
  return startDictation(dictationPort, lang);
}

const responsePort = {
  async getLastResponseData(): Promise<Record<string, unknown> | null> {
    const response = await Notifications.getLastNotificationResponseAsync();
    const data = response?.notification.request.content.data ?? null;
    if (response) Notifications.clearLastNotificationResponse();
    return data;
  },
  addResponseListener(listener: (data: Record<string, unknown>) => void) {
    return Notifications.addNotificationResponseReceivedListener((response) => {
      listener(response.notification.request.content.data ?? {});
    });
  },
};

export const expoNotificationService: NativeNotificationService = {
  platform: Platform.OS === "android" || Platform.OS === "ios" ? Platform.OS : null,
  port: {
    isPhysicalDevice: Device.isDevice,
    async getPermission() {
      return permissionState(await Notifications.getPermissionsAsync());
    },
    async requestPermission() {
      return permissionState(
        await Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowBadge: true, allowSound: true },
        }),
      );
    },
    async getExpoPushToken() {
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          importance: Notifications.AndroidImportance.DEFAULT,
          name: "Symphony updates",
        });
      }
      const projectId =
        process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
        Constants.expoConfig?.extra?.eas?.projectId ??
        Constants.easConfig?.projectId;
      if (typeof projectId !== "string" || !projectId.trim()) {
        throw new Error("Expo project id is not configured for push notifications");
      }
      return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    },
  },
  router: createNotificationRouter(responsePort),
  deviceId: () => loadOrCreateDeviceId(AsyncStorage, createDeviceId),
  openSettings: () => Linking.openSettings(),
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function permissionState(permission: { granted: boolean; status: string }): NotificationPermission {
  if (permission.granted || permission.status === "granted") return "granted";
  return permission.status === "denied" ? "denied" : "undetermined";
}

function createDeviceId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
