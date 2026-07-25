import { describe, expect, it, vi } from "vitest";

import { createFixtureRuntime, fixtureModeFromUrl } from "./fixture-runtime";

describe("fixture runtime boundary", () => {
  it("requires an E2E build and explicit launch parameter", () => {
    expect(fixtureModeFromUrl("1", "symphony:///?fixture=1")).toBe(true);
    expect(fixtureModeFromUrl(undefined, "symphony:///?fixture=1")).toBe(false);
    expect(fixtureModeFromUrl("1", "symphony:///")).toBe(false);
  });

  it("injects deterministic data through real storage, API, and session contracts", async () => {
    const runtime = createFixtureRuntime();
    const snapshot = await runtime.connectionStorage?.loadSnapshot();
    const client = runtime.createTrackerClient({
      origin: "https://fixture.test",
      token: "token",
      locale: "en",
    });
    const onAction = vi.fn();
    const onSeedAccepted = vi.fn();

    expect(snapshot?.activeProfileId).toBe("e2e-remote");
    await expect(client.projects()).resolves.toEqual([
      expect.objectContaining({ slug: "symphony" }),
    ]);
    await expect(client.issues("symphony")).resolves.toEqual([
      expect.objectContaining({ identifier: "MOB-7" }),
    ]);
    const session = runtime.createAssistantSession({
      threadId: 42,
      origin: "https://fixture.test",
      token: "token",
      seed: "Build the mobile session",
      onAction,
      onSeedAccepted,
    });
    session.connect();

    expect(onAction).toHaveBeenCalledWith({
      type: "history_loaded",
      messages: expect.arrayContaining([
        expect.objectContaining({ content: "Build the mobile session" }),
      ]),
    });
    expect(onSeedAccepted).toHaveBeenCalledTimes(1);

    const reloadedAction = vi.fn();
    runtime
      .createAssistantSession({
        threadId: 42,
        origin: "https://fixture.test",
        token: "token",
        onAction: reloadedAction,
      })
      .connect();

    expect(reloadedAction).toHaveBeenCalledWith({
      type: "history_loaded",
      messages: expect.arrayContaining([
        expect.objectContaining({ content: "Build the mobile session" }),
      ]),
    });
  });

  it("supports deterministic connection switching and removal", async () => {
    const storage = createFixtureRuntime().connectionStorage!;
    const initial = await storage.loadSnapshot();
    expect(initial.profiles.map((profile) => profile.id)).toEqual(["e2e-remote", "e2e-local"]);

    await expect(storage.selectProfile("e2e-local")).resolves.toEqual(
      expect.objectContaining({ activeProfileId: "e2e-local" }),
    );
    await expect(storage.removeProfile("e2e-local")).resolves.toEqual({
      profiles: [expect.objectContaining({ id: "e2e-remote" })],
      activeProfileId: "e2e-remote",
    });
  });
});
