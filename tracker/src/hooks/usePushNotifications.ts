import { useCallback, useEffect, useState } from "react";

import {
  fetchPushConfig,
  getLocalPushSubscription,
  pushSupported,
  subscribeToPush,
  unsubscribeFromPush,
  type PushConfig,
} from "@/services/pushNotifications";

export interface UsePushNotificationsResult {
  supported: boolean;
  config: PushConfig | null;
  subscribed: boolean;
  loading: boolean;
  busy: boolean;
  error: string | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function usePushNotifications(): UsePushNotificationsResult {
  const supported = pushSupported();
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supported) {
      setLoading(false);
      return;
    }

    setError(null);

    try {
      const [nextConfig, localSubscription] = await Promise.all([
        fetchPushConfig(),
        getLocalPushSubscription(),
      ]);
      setConfig(nextConfig);
      setSubscribed(Boolean(localSubscription));
    } catch {
      setError("Failed to load push notification settings");
    } finally {
      setLoading(false);
    }
  }, [supported]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    if (!supported || !config?.enabled || !config.public_key) return;

    setBusy(true);
    setError(null);

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Notification permission was denied");
        return;
      }

      await subscribeToPush(config.public_key);
      setSubscribed(true);
    } catch {
      setError("Failed to enable browser notifications");
    } finally {
      setBusy(false);
    }
  }, [config, supported]);

  const disable = useCallback(async () => {
    setBusy(true);
    setError(null);

    try {
      await unsubscribeFromPush();
      setSubscribed(false);
    } catch {
      setError("Failed to disable browser notifications");
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    supported,
    config,
    subscribed,
    loading,
    busy,
    error,
    enable,
    disable,
    refresh,
  };
}
