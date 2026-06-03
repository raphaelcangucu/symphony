import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { KeyValueMapEditor } from "@/components/projects/config/KeyValueMapEditor";

describe("KeyValueMapEditor", () => {
  it("lists existing entries and removes one", async () => {
    const onChange = vi.fn();
    render(
      <KeyValueMapEditor
        label="Completion transitions"
        keyOptions={["In Review", "Done"]}
        valueKind="state"
        valueOptions={["In Review", "Done"]}
        value={{ "In Review": "Done" }}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("button", { name: /remove In Review/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /remove In Review/i }));
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("adds a new key/value entry", async () => {
    const onChange = vi.fn();
    render(
      <KeyValueMapEditor
        label="Concurrency by state"
        keyOptions={["In Progress"]}
        valueKind="number"
        value={{}}
        onChange={onChange}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText(/add key/i), "In Progress");
    await userEvent.type(screen.getByLabelText(/new value/i), "2");
    await userEvent.click(screen.getByRole("button", { name: /add entry/i }));

    expect(onChange).toHaveBeenCalledWith({ "In Progress": 2 });
  });
});
