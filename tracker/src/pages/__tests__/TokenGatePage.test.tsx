import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TRACKER_TOKEN_KEY } from "@/config";
import { TokenGatePage } from "@/pages/TokenGatePage";
import * as authService from "@/services/auth";
import * as viewerService from "@/services/viewer";

vi.mock("@/services/auth", () => ({
  validateTrackerToken: vi.fn(),
}));

vi.mock("@/services/viewer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/viewer")>();
  return {
    ...actual,
    fetchViewer: vi.fn(),
  };
});

function renderTokenGate() {
  render(
    <MemoryRouter initialEntries={["/token"]}>
      <Routes>
        <Route path="/token" element={<TokenGatePage />} />
        <Route path="/projects" element={<div>Projects page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TokenGatePage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("validates the token before saving and navigating to projects", async () => {
    vi.mocked(authService.validateTrackerToken).mockResolvedValue(undefined);
    vi.mocked(viewerService.fetchViewer).mockResolvedValue({
      githubLogin: "octocat",
      name: null,
      avatarUrl: null,
    });
    renderTokenGate();

    fireEvent.change(screen.getByPlaceholderText("Tracker token"), { target: { value: "secret-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(authService.validateTrackerToken).toHaveBeenCalledWith("secret-token"));
    expect(window.localStorage.getItem(TRACKER_TOKEN_KEY)).toBe("secret-token");
    await waitFor(() => expect(screen.getByText("Projects page")).toBeTruthy());
  });

  it("stays on token page and does not save invalid tokens", async () => {
    vi.mocked(authService.validateTrackerToken).mockRejectedValue(new Error("invalid tracker token"));
    renderTokenGate();

    fireEvent.change(screen.getByPlaceholderText("Tracker token"), { target: { value: "bad-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(authService.validateTrackerToken).toHaveBeenCalledWith("bad-token"));
    expect(window.localStorage.getItem(TRACKER_TOKEN_KEY)).toBeNull();
    expect(screen.getByText("Invalid tracker token.")).toBeTruthy();
  });

  it("blocks navigation and clears token when viewer fails", async () => {
    vi.mocked(authService.validateTrackerToken).mockResolvedValueOnce(undefined);
    vi.mocked(viewerService.fetchViewer).mockRejectedValueOnce(
      new viewerService.ViewerNotConfiguredError("github_token_missing"),
    );

    renderTokenGate();

    fireEvent.change(screen.getByPlaceholderText("Tracker token"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(screen.getByText(/GITHUB_TOKEN is not configured/i)).toBeTruthy(),
    );
    expect(window.localStorage.getItem("symphony.tracker.token")).toBeNull();
  });
});
