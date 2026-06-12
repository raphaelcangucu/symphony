import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { JiraTrackerFields } from "@/components/projects/JiraTrackerFields";

function Harness({
  initial,
  onChange,
}: {
  initial: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const [config, setConfig] = useState<Record<string, unknown>>(initial);
  return (
    <JiraTrackerFields
      config={config}
      onConfigChange={(changes) =>
        setConfig((current) => {
          const next = { ...current, ...changes };
          onChange(next);
          return next;
        })
      }
    />
  );
}

describe("JiraTrackerFields", () => {
  it("renders the project key and existing field filter from config", () => {
    render(<JiraTrackerFields config={{ project_key: "CDE", fields: { Product: "Inspire" } }} onConfigChange={vi.fn()} />);

    expect(screen.getByLabelText(/Project key/i)).toHaveValue("CDE");
    expect(screen.getByDisplayValue("Product")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Inspire")).toBeInTheDocument();
  });

  it("emits the project key as it is typed", async () => {
    const onConfigChange = vi.fn();
    render(<JiraTrackerFields config={{}} onConfigChange={onConfigChange} />);

    await userEvent.type(screen.getByLabelText(/Project key/i), "C");
    expect(onConfigChange).toHaveBeenCalledWith({ project_key: "C" });
  });

  it("rebuilds the fields map when a filter value changes", async () => {
    const onConfigChange = vi.fn();
    render(<JiraTrackerFields config={{ project_key: "CDE", fields: { Product: "Insp" } }} onConfigChange={onConfigChange} />);

    await userEvent.type(screen.getByDisplayValue("Insp"), "i");
    expect(onConfigChange).toHaveBeenLastCalledWith({ fields: { Product: "Inspi" } });
  });

  it("adds and removes filter rows, dropping blank field names", async () => {
    const onConfigChange = vi.fn();
    render(<JiraTrackerFields config={{ project_key: "CDE" }} onConfigChange={onConfigChange} />);

    await userEvent.click(screen.getByRole("button", { name: /add filter/i }));
    const fieldInputs = screen.getAllByLabelText("Filter field");
    expect(fieldInputs).toHaveLength(1);

    await userEvent.type(fieldInputs[0], "Squad");
    expect(onConfigChange).toHaveBeenLastCalledWith({ fields: { Squad: "" } });

    await userEvent.click(screen.getByRole("button", { name: /remove filter/i }));
    expect(onConfigChange).toHaveBeenLastCalledWith({ fields: {} });
  });

  it("parses max results into a number and clears invalid input", async () => {
    const onChange = vi.fn();
    render(<Harness initial={{ project_key: "CDE" }} onChange={onChange} />);

    const input = screen.getByLabelText(/Max results/i);
    await userEvent.type(input, "250");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ max_results: 250 }));

    await userEvent.clear(input);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ max_results: undefined }));
  });
});
