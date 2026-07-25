import { describe, expect, it, vi } from "vitest";

import {
  createNotificationRouter,
  loadOrCreateDeviceId,
  notificationRoute,
  registerNativeNotifications,
  unregisterNativeNotifications,
} from "./notifications";

describe("notificationRoute", () => {
  it("allows only issue and session deep links", () => {
    expect(notificationRoute({ route: "/session/42" })).toBe("/session/42");
    expect(
      notificationRoute({
        type: "issue",
        project_slug: "mobile app",
        identifier: "MOB/7",
      }),
    ).toBe("/issue/mobile%20app/MOB%2F7");
    expect(
      notificationRoute({
        url: "/tracker/projects/symphony/board/issues/MOB-7/pull-request",
      }),
    ).toBe("/issue/symphony/MOB-7/pull-request");
    expect(
      notificationRoute({
        url: "/tracker/projects/symphony/workspaces/42",
      }),
    ).toBe("/session/42");
    expect(notificationRoute({ route: "https://evil.test/session/42" })).toBeNull();
    expect(notificationRoute({ route: "/settings" })).toBeNull();
  });
});

describe("native notification registration", () => {
  it("surfaces denied permissions without requesting or persisting a token", async () => {
    const port = {
      isPhysicalDevice: true,
      getPermission: vi.fn().mockResolvedValue("denied" as const),
      requestPermission: vi.fn(),
      getExpoPushToken: vi.fn(),
    };
    const api = { register: vi.fn(), unregister: vi.fn() };

    await expect(
      registerNativeNotifications({
        api,
        deviceId: "device-1",
        platform: "ios",
        port,
        profileId: "profile-1",
      }),
    ).resolves.toEqual({ state: "denied" });
    expect(port.requestPermission).not.toHaveBeenCalled();
    expect(port.getExpoPushToken).not.toHaveBeenCalled();
    expect(api.register).not.toHaveBeenCalled();
  });

  it("registers and unregisters a device per connection profile", async () => {
    const port = {
      isPhysicalDevice: true,
      getPermission: vi.fn().mockResolvedValue("undetermined" as const),
      requestPermission: vi.fn().mockResolvedValue("granted" as const),
      getExpoPushToken: vi.fn().mockResolvedValue("ExponentPushToken[secret]"),
    };
    const api = {
      register: vi.fn().mockResolvedValue({ registered: true }),
      unregister: vi.fn().mockResolvedValue({ deleted: true }),
    };

    await expect(
      registerNativeNotifications({
        api,
        deviceId: "device-1",
        platform: "android",
        port,
        profileId: "profile-1",
      }),
    ).resolves.toEqual({ state: "registered" });
    expect(api.register).toHaveBeenCalledWith({
      deviceId: "device-1",
      platform: "android",
      profileId: "profile-1",
      token: "ExponentPushToken[secret]",
    });
    await unregisterNativeNotifications({
      api,
      deviceId: "device-1",
      profileId: "profile-1",
    });
    expect(api.unregister).toHaveBeenCalledWith({
      deviceId: "device-1",
      profileId: "profile-1",
    });
  });
});

describe("notification response routing", () => {
  it("routes the last response and future responses through the same allowlist", async () => {
    let responseListener: ((data: Record<string, unknown>) => void) | null = null;
    const port = {
      getLastResponseData: vi.fn().mockResolvedValue({ type: "session", thread_id: 42 }),
      addResponseListener: vi.fn((listener: (data: Record<string, unknown>) => void) => {
        responseListener = listener;
        return { remove: vi.fn() };
      }),
    };
    const router = createNotificationRouter(port);
    const listener = vi.fn();

    await expect(router.initialRoute()).resolves.toBe("/session/42");
    router.subscribe(listener);
    responseListener?.({ route: "/settings" });
    responseListener?.({
      type: "issue",
      project_slug: "symphony",
      identifier: "MOB-7",
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("/issue/symphony/MOB-7");
  });
});

describe("loadOrCreateDeviceId", () => {
  it("reuses the private app installation id instead of rotating registrations", async () => {
    const storage = {
      getItem: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce("device-existing"),
      setItem: vi.fn().mockResolvedValue(undefined),
    };

    await expect(loadOrCreateDeviceId(storage, () => "device-new")).resolves.toBe("device-new");
    await expect(loadOrCreateDeviceId(storage, () => "unused")).resolves.toBe("device-existing");
    expect(storage.setItem).toHaveBeenCalledWith(
      "symphony.native-notifications.device-id",
      "device-new",
    );
  });
});
