import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConnectedIdentitiesCard } from "@/components/settings/ConnectedIdentitiesCard";
import * as settingsService from "@/services/settings";

vi.mock("@/services/settings", () => ({
  fetchIdentities: vi.fn(),
}));

describe("ConnectedIdentitiesCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders connected, error, and unconfigured provider states", async () => {
    vi.mocked(settingsService.fetchIdentities).mockResolvedValue([
      {
        provider: "github",
        configured: true,
        connected: true,
        identity: { provider: "github", match_value: "octocat", login: "octocat", name: "The Octocat", email: null, avatar_url: null },
        error: null,
      },
      {
        provider: "jira",
        configured: true,
        connected: false,
        identity: null,
        error: "401 Unauthorized",
      },
      { provider: "linear", configured: false, connected: false, identity: null, error: null },
    ]);

    render(<ConnectedIdentitiesCard />);

    await waitFor(() => expect(screen.getByText("The Octocat")).toBeTruthy());
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("Error")).toBeTruthy();
    expect(screen.getByText(/401 Unauthorized/)).toBeTruthy();
    expect(screen.getByText("Not configured")).toBeTruthy();
  });
});
