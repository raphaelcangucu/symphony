import { useRouter } from "expo-router";
import { useEffect, useState } from "react";

import { useTrackerClient } from "@/api/TrackerClientProvider";
import { useConnection } from "@/auth/ConnectionProvider";
import { registerNativeNotifications, unregisterNativeNotifications } from "@/native/notifications";
import { useAppRuntime } from "@/runtime/AppRuntime";

import { NotificationsScreen, type NotificationState } from "./NotificationsScreen";

export function NotificationsRoute() {
  const router = useRouter();
  const client = useTrackerClient();
  const { activeProfile } = useConnection();
  const { notifications } = useAppRuntime();
  const [state, setState] = useState<NotificationState>("inactive");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastRoute, setLastRoute] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void notifications.router.initialRoute().then((route) => {
      if (active && route) setLastRoute(route);
    });
    const subscription = notifications.router.subscribe(setLastRoute);
    return () => {
      active = false;
      subscription.remove();
    };
  }, [notifications]);

  async function enable() {
    const platform = notifications.platform;
    if (!client || !activeProfile || !platform) {
      setState("unsupported");
      return;
    }
    await perform(async () => {
      const deviceId = await notifications.deviceId();
      const result = await registerNativeNotifications({
        api: {
          register: (input) => client.registerMobilePush(input),
          unregister: (input) => client.unregisterMobilePush(input),
        },
        deviceId,
        platform,
        port: notifications.port,
        profileId: activeProfile.hostId ?? activeProfile.id,
      });
      setState(result.state);
      setMessage(
        result.state === "registered"
          ? "This device will receive task and session updates."
          : result.state === "denied"
            ? "Notifications are blocked by the device."
            : "Push notifications require a physical device.",
      );
    });
  }

  async function disable() {
    if (!client || !activeProfile) return;
    await perform(async () => {
      await unregisterNativeNotifications({
        api: {
          register: (input) => client.registerMobilePush(input),
          unregister: (input) => client.unregisterMobilePush(input),
        },
        deviceId: await notifications.deviceId(),
        profileId: activeProfile.hostId ?? activeProfile.id,
      });
      setState("inactive");
      setMessage("Notifications disabled for this connection.");
    });
  }

  async function sendTest() {
    if (!client) return;
    await perform(async () => {
      const result = await client.sendTestMobilePush();
      setMessage(
        result.sent
          ? `Test sent to ${result.deviceCount} device${result.deviceCount === 1 ? "" : "s"}.`
          : "No registered device accepted the test notification.",
      );
    });
  }

  async function perform(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await operation();
    } catch (cause) {
      setState("error");
      setMessage(cause instanceof Error ? cause.message : "Notification action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <NotificationsScreen
      busy={busy}
      lastRoute={lastRoute}
      message={message}
      onBack={() => router.back()}
      onDisable={() => void disable()}
      onEnable={() => void enable()}
      onOpenSettings={() => void notifications.openSettings()}
      onSendTest={() => void sendTest()}
      state={state}
    />
  );
}
