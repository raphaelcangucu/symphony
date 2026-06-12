import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrackerSourcePicker } from "@/components/projects/TrackerSourcePicker";

describe("TrackerSourcePicker", () => {
  it("renders every source option and reports selection", async () => {
    const onChange = vi.fn();
    render(<TrackerSourcePicker value="local" onChange={onChange} />);

    expect(screen.getByText(/Symphony local tracker/i)).toBeInTheDocument();
    expect(screen.getByText(/GitHub Project/i)).toBeInTheDocument();
    expect(screen.getByText(/Linear project/i)).toBeInTheDocument();
    expect(screen.getByText(/Jira project/i)).toBeInTheDocument();

    await userEvent.click(screen.getByText(/GitHub Project/i));
    expect(onChange).toHaveBeenCalledWith("github");

    await userEvent.click(screen.getByText(/Jira project/i));
    expect(onChange).toHaveBeenCalledWith("jira");
  });
});
