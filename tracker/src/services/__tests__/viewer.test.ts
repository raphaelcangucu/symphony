import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { http } from "@/services/http";
import { fetchViewer, normalizeViewer } from "@/services/viewer";
import { i18n } from "@/i18n";
import { initTestI18n } from "@/i18n/testUtils";

describe("viewer service", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  afterEach(() => vi.restoreAllMocks());

  it("returns the normalized viewer payload", async () => {
    vi.spyOn(http, "get").mockResolvedValueOnce({
      data: { data: { github_login: "octocat", name: "Octo", avatar_url: "https://x" } },
    });

    await expect(fetchViewer()).resolves.toEqual({
      githubLogin: "octocat",
      name: "Octo",
      avatarUrl: "https://x",
    });
  });

  it("throws when the viewer payload is missing github_login", () => {
    expect(() => normalizeViewer({ name: "Octo" })).toThrow(i18n.t("auth.viewerErrors.missingLogin"));
  });

  it("throws ViewerNotConfiguredError on 503 github_token_missing", async () => {
    vi.spyOn(http, "get").mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 503,
        data: { error: { code: "github_token_missing", message: "missing" } },
      },
    });

    await expect(fetchViewer()).rejects.toMatchObject({
      name: "ViewerNotConfiguredError",
      code: "github_token_missing",
    });
  });

  it("throws ViewerNotConfiguredError on 401 github_unauthorized", async () => {
    vi.spyOn(http, "get").mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 401,
        data: { error: { code: "github_unauthorized", message: "bad token" } },
      },
    });

    await expect(fetchViewer()).rejects.toMatchObject({
      name: "ViewerNotConfiguredError",
      code: "github_unauthorized",
    });
  });

  it("throws ViewerNotConfiguredError with resetAt on 429 github_rate_limited", async () => {
    vi.spyOn(http, "get").mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 429,
        data: {
          error: {
            code: "github_rate_limited",
            message: "rate limited",
            reset_at: "2026-05-30T23:13:13Z",
          },
        },
      },
    });

    await expect(fetchViewer()).rejects.toMatchObject({
      name: "ViewerNotConfiguredError",
      code: "github_rate_limited",
      resetAt: "2026-05-30T23:13:13Z",
    });
  });
});
