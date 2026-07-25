export type NotificationPermission = "granted" | "denied" | "undetermined";

export type NotificationPort = {
  isPhysicalDevice: boolean;
  getPermission(): Promise<NotificationPermission>;
  requestPermission(): Promise<NotificationPermission>;
  getExpoPushToken(): Promise<string>;
};

export type NotificationRouteSubscription = {
  remove(): void;
};

export type NotificationResponsePort = {
  getLastResponseData(): Promise<Record<string, unknown> | null>;
  addResponseListener(
    listener: (data: Record<string, unknown>) => void,
  ): NotificationRouteSubscription;
};

export type NotificationRouter = {
  initialRoute(): Promise<NotificationDestination | null>;
  subscribe(listener: (destination: NotificationDestination) => void): NotificationRouteSubscription;
};

export type NotificationDestination = {
  route: string;
  hostId: string | null;
};

type NotificationProfile = {
  id: string;
  hostId?: string;
};

export type NativeNotificationService = {
  platform: "android" | "ios" | null;
  port: NotificationPort;
  router: NotificationRouter;
  deviceId(): Promise<string>;
  openSettings(): Promise<unknown>;
};

export type DeviceIdStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
};

export type NativePushApi = {
  register(input: NativePushRegistration): Promise<unknown>;
  unregister(input: NativePushIdentity): Promise<unknown>;
};

export type NativePushIdentity = {
  profileId: string;
  deviceId: string;
};

export type NativePushRegistration = NativePushIdentity & {
  token: string;
  platform: "android" | "ios";
};

type RegistrationInput = NativePushIdentity & {
  api: NativePushApi;
  platform: "android" | "ios";
  port: NotificationPort;
};

export async function registerNativeNotifications({
  api,
  deviceId,
  platform,
  port,
  profileId,
}: RegistrationInput): Promise<{
  state: "registered" | "denied" | "unsupported";
}> {
  if (!port.isPhysicalDevice) return { state: "unsupported" };
  const current = await port.getPermission();
  if (current === "denied") return { state: "denied" };
  const permission = current === "granted" ? current : await port.requestPermission();
  if (permission !== "granted") return { state: "denied" };
  const token = await port.getExpoPushToken();
  await api.register({
    deviceId: required(deviceId, "device id"),
    platform,
    profileId: required(profileId, "profile id"),
    token: required(token, "Expo push token"),
  });
  return { state: "registered" };
}

export async function unregisterNativeNotifications({
  api,
  deviceId,
  profileId,
}: NativePushIdentity & { api: NativePushApi }): Promise<void> {
  await api.unregister({
    deviceId: required(deviceId, "device id"),
    profileId: required(profileId, "profile id"),
  });
}

export function createNotificationRouter(port: NotificationResponsePort): NotificationRouter {
  return {
    async initialRoute() {
      const data = await port.getLastResponseData();
      return data ? notificationDestination(data) : null;
    },
    subscribe(listener) {
      return port.addResponseListener((data) => {
        const destination = notificationDestination(data);
        if (destination) listener(destination);
      });
    },
  };
}

export function notificationDestination(
  data: Record<string, unknown>,
): NotificationDestination | null {
  const route = notificationRoute(data);
  if (!route) return null;
  return {
    route,
    hostId: stringValue(data.host_id) ?? stringValue(data.profile_id),
  };
}

export async function activateNotificationDestination({
  destination,
  profiles,
  selectProfile,
  openRoute,
}: {
  destination: NotificationDestination;
  profiles: NotificationProfile[];
  selectProfile(profileId: string): Promise<void>;
  openRoute(route: string): void;
}): Promise<boolean> {
  if (destination.hostId) {
    const profile = profiles.find(
      (candidate) =>
        candidate.hostId === destination.hostId || candidate.id === destination.hostId,
    );
    if (!profile) return false;
    await selectProfile(profile.id);
  }
  openRoute(destination.route);
  return true;
}

export async function loadOrCreateDeviceId(
  storage: DeviceIdStorage,
  createId: () => string,
): Promise<string> {
  const key = "symphony.native-notifications.device-id";
  const stored = await storage.getItem(key);
  if (stored?.trim()) return stored;
  const deviceId = required(createId(), "device id");
  await storage.setItem(key, deviceId);
  return deviceId;
}

export function notificationRoute(data: Record<string, unknown>): string | null {
  const direct = stringValue(data.route);
  if (direct) return safeDirectRoute(direct);

  if (data.type === "session") {
    const threadId = Number(data.thread_id);
    return Number.isInteger(threadId) && threadId > 0 ? `/session/${threadId}` : null;
  }
  if (data.type === "issue") {
    const projectSlug = stringValue(data.project_slug);
    const identifier = stringValue(data.identifier);
    return projectSlug && identifier
      ? `/issue/${encodeURIComponent(projectSlug)}/${encodeURIComponent(identifier)}`
      : null;
  }

  const legacyUrl = stringValue(data.url);
  if (!legacyUrl || legacyUrl.includes("?") || legacyUrl.includes("#")) return null;
  const issueMatch = legacyUrl.match(
    /^\/tracker\/projects\/([^/]+)\/board\/issues\/([^/]+)(?:\/([^/]+))?$/,
  );
  if (issueMatch?.[1] && issueMatch[2]) {
    const suffix = issueMatch[3] === "pull-request" ? "/pull-request" : "";
    return `/issue/${encodeURIComponent(issueMatch[1])}/${encodeURIComponent(issueMatch[2])}${suffix}`;
  }
  const sessionMatch = legacyUrl.match(/^\/tracker\/projects\/[^/]+\/workspaces\/([1-9]\d*)$/);
  return sessionMatch?.[1] ? `/session/${sessionMatch[1]}` : null;
}

function safeDirectRoute(route: string): string | null {
  if (/^\/session\/[1-9]\d*$/.test(route)) return route;
  if (/^\/issue\/[^/?#]+\/[^/?#]+(?:\/pull-request)?$/.test(route)) return route;
  return null;
}

function required(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Notification ${label} is required`);
  return trimmed;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
