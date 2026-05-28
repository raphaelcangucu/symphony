import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LinearProjectPicker } from "@/components/projects/LinearProjectPicker";
import * as remote from "@/services/remoteTrackers";

vi.mock("@/services/remoteTrackers");

describe("LinearProjectPicker", () => {
  it("lists projects and reports selection", async () => {
    vi.mocked(remote.discoverLinearProjects).mockResolvedValue([
      { id: "p1", slugId: "s", name: "Proj", state: "started", team: { id: "t", name: "Team" } },
    ]);
    const onSelect = vi.fn();

    render(<LinearProjectPicker onSelect={onSelect} />);

    await waitFor(() => expect(screen.getByText("Proj")).toBeInTheDocument());
    await userEvent.click(screen.getByText("Proj"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
  });
});
