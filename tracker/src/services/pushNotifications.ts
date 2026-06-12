import { http, trackerPath, unwrapData } from "@/services/http";

export interface PushConfig {
  enabled: boolean;
  public_key: string | null;
  subject: string;
  subscription_count: number;
}

export interface PushSubscriptionRecord {
  id: number;
  endpoint: string;
  inserted_at: string;
}

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function serviceWorkerUrl(): string {
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}sw.js`;
}

export async function fetchPushConfig(): Promise<PushConfig> {
  const response = await http.get(trackerPath("/push/config"));
  return unwrapData<PushConfig>(response);
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;

  try {
    return await navigator.serviceWorker.register(serviceWorkerUrl(), {
      scope: import.meta.env.BASE_URL,
    });
  } catch (error) {
    console.error("Failed to register push service worker", error);
    return null;
  }
}

export async function subscribeToPush(publicKey: string): Promise<PushSubscription | null> {
  const registration = await registerServiceWorker();
  if (!registration) return null;

  await navigator.serviceWorker.ready;

  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    await syncPushSubscription(existing);
    return existing;
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await syncPushSubscription(subscription);
  return subscription;
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();

  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await http.delete(trackerPath("/push/subscriptions"), { data: { endpoint } });
}

async function syncPushSubscription(subscription: PushSubscription): Promise<PushSubscriptionRecord> {
  const response = await http.post(trackerPath("/push/subscriptions"), subscription.toJSON());
  return unwrapData<PushSubscriptionRecord>(response);
}

export async function getLocalPushSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;

  try {
    const scope = import.meta.env.BASE_URL;
    const registration = await navigator.serviceWorker.getRegistration(scope);
    if (!registration) return null;
    return registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export async function sendTestPushNotification(): Promise<{ sent: boolean; subscription_count: number }> {
  const response = await http.post(trackerPath("/push/test"));
  return unwrapData<{ sent: boolean; subscription_count: number }>(response);
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}
