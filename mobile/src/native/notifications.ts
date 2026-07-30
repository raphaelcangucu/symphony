import { routeForView, type ViewTarget } from "@/preferences/view-routing";

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
  subscribe(
    listener: (destination: NotificationDestination) => void,
  ): NotificationRouteSubscription;
};

export type NotificationDestination = {
  target: NotificationTarget;
  hostId: string | null;
};

export type NotificationTarget =
  | Omit<Extract<ViewTarget, { kind: "session" }>, "hostId">
  | Omit<Extract<ViewTarget, { kind: "issue" }>, "hostId">;

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
  const target = notificationTarget(data);
  if (!target) return null;
  return {
    target,
    hostId: stringValue(data.host_id) ?? stringValue(data.profile_id),
  };
}

export async function activateNotificationDestination({
  destination,
  profiles,
  selectProfile,
  openRoute,
  selectedHostId = null,
}: {
  destination: NotificationDestination;
  profiles: NotificationProfile[];
  selectProfile(profileId: string): Promise<void>;
  openRoute(route: string): void;
  selectedHostId?: string | null;
}): Promise<boolean> {
  const hostId = destination.hostId ?? selectedHostId;
  if (!hostId) return false;
  if (destination.hostId) {
    const profile = profiles.find(
      (candidate) => candidate.hostId === hostId || candidate.id === hostId,
    );
    if (!profile) return false;
    await selectProfile(profile.id);
  }
  openRoute(routeForView({ ...destination.target, hostId } as ViewTarget));
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
  const target = notificationTarget(data);
  return target ? notificationTargetRoute(target) : null;
}

export function notificationTargetRoute(target: NotificationTarget): string {
  if (target.kind === "session") {
    return `/session/${encodeURIComponent(target.id)}${target.surface ? `/${target.surface}` : ""}`;
  }
  return `/issue/${encodeURIComponent(target.projectSlug)}/${encodeURIComponent(target.identifier)}${
    target.pullRequest ? "/pull-request" : ""
  }`;
}

export function notificationTarget(data: Record<string, unknown>): NotificationTarget | null {
  const direct = stringValue(data.route);
  if (direct) {
    const directTarget = targetFromDirectRoute(direct);
    if (directTarget) return directTarget;
    return null;
  }

  if (data.type === "session") {
    const threadId = Number(data.thread_id);
    return Number.isInteger(threadId) && threadId > 0
      ? { kind: "session", id: String(threadId) }
      : null;
  }
  if (data.type === "issue") {
    const projectSlug = stringValue(data.project_slug);
    const identifier = stringValue(data.identifier);
    return projectSlug && identifier ? { kind: "issue", projectSlug, identifier } : null;
  }

  const legacyUrl = stringValue(data.url);
  if (!legacyUrl || legacyUrl.includes("?") || legacyUrl.includes("#")) return null;
  const issueMatch = legacyUrl.match(
    /^\/tracker\/projects\/([^/]+)\/board\/issues\/([^/]+)(?:\/([^/]+))?$/,
  );
  if (issueMatch?.[1] && issueMatch[2]) {
    return {
      kind: "issue",
      projectSlug: decodeURIComponent(issueMatch[1]),
      identifier: decodeURIComponent(issueMatch[2]),
      pullRequest: issueMatch[3] === "pull-request",
    };
  }
  const sessionMatch = legacyUrl.match(/^\/tracker\/projects\/[^/]+\/workspaces\/([1-9]\d*)$/);
  return sessionMatch?.[1] ? { kind: "session", id: sessionMatch[1] } : null;
}

function targetFromDirectRoute(route: string): NotificationTarget | null {
  const sessionMatch = route.match(
    /^\/(?:codex\/)?session\/([1-9]\d*)(?:\/(diff|files|preview|terminal))?$/,
  );
  if (sessionMatch?.[1]) {
    return {
      kind: "session",
      id: sessionMatch[1],
      ...(sessionMatch[2]
        ? { surface: sessionMatch[2] as "diff" | "files" | "preview" | "terminal" }
        : {}),
    };
  }
  const issueMatch = route.match(
    /^\/(?:codex\/)?issue\/([^/?#]+)\/([^/?#]+)(?:\/(pull-request))?$/,
  );
  if (issueMatch?.[1] && issueMatch[2]) {
    return {
      kind: "issue",
      projectSlug: decodeURIComponent(issueMatch[1]),
      identifier: decodeURIComponent(issueMatch[2]),
      pullRequest: issueMatch[3] === "pull-request",
    };
  }
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
