import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GitHubProjectPicker } from "@/components/projects/GitHubProjectPicker";
import * as remote from "@/services/remoteTrackers";

vi.mock("@/services/remoteTrackers");

describe("GitHubProjectPicker", () => {
  it("lists boards and reports selection", async () => {
    vi.mocked(remote.discoverGitHubProjects).mockResolvedValue([
      { id: "PVT_1", number: 7, title: "Roadmap", owner: { login: "o", kind: "user" }, repoNameWithOwner: "o/r" },
    ]);
    const onSelect = vi.fn();

    render(<GitHubProjectPicker onSelect={onSelect} />);

    await waitFor(() => expect(screen.getByText(/Roadmap/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Roadmap/));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "PVT_1", number: 7 }));
  });
});
