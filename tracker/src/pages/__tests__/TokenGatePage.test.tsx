import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TRACKER_TOKEN_KEY } from "@/config";
import { validateTrackerToken } from "@/services/auth";
import { TokenGatePage } from "@/pages/TokenGatePage";

vi.mock("@/services/auth", () => ({
  validateTrackerToken: vi.fn(),
}));

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
    vi.mocked(validateTrackerToken).mockResolvedValue(undefined);
    renderTokenGate();

    fireEvent.change(screen.getByPlaceholderText("Tracker token"), { target: { value: "secret-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(validateTrackerToken).toHaveBeenCalledWith("secret-token"));
    expect(window.localStorage.getItem(TRACKER_TOKEN_KEY)).toBe("secret-token");
    await waitFor(() => expect(screen.getByText("Projects page")).toBeTruthy());
  });

  it("stays on token page and does not save invalid tokens", async () => {
    vi.mocked(validateTrackerToken).mockRejectedValue(new Error("invalid tracker token"));
    renderTokenGate();

    fireEvent.change(screen.getByPlaceholderText("Tracker token"), { target: { value: "bad-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(validateTrackerToken).toHaveBeenCalledWith("bad-token"));
    expect(window.localStorage.getItem(TRACKER_TOKEN_KEY)).toBeNull();
    expect(screen.getByText("Invalid tracker token.")).toBeTruthy();
  });
});
