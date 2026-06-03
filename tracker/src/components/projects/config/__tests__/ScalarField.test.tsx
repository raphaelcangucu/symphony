import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ScalarField } from "@/components/projects/config/ScalarField";

function NumberHarness({
  onEmit,
  initial,
}: {
  onEmit: (v: string | number | boolean | undefined) => void;
  initial: number | undefined;
}) {
  const [value, setValue] = useState<string | number | boolean | undefined>(initial);
  return (
    <ScalarField
      descriptor={{ key: "max_turns", label: "Max turns", kind: "number" }}
      value={value}
      onChange={(next) => {
        setValue(next);
        onEmit(next);
      }}
    />
  );
}

describe("ScalarField", () => {
  it("emits parsed integers for number fields and undefined when cleared", async () => {
    const onEmit = vi.fn();
    render(<NumberHarness onEmit={onEmit} initial={40} />);

    const input = screen.getByLabelText("Max turns");
    await userEvent.clear(input);
    expect(onEmit).toHaveBeenLastCalledWith(undefined);

    await userEvent.type(input, "12");
    expect(onEmit).toHaveBeenLastCalledWith(12);
  });

  it("renders a checkbox for boolean fields", async () => {
    const onChange = vi.fn();
    render(
      <ScalarField descriptor={{ key: "enabled", label: "Enabled", kind: "boolean" }} value={false} onChange={onChange} />,
    );

    await userEvent.click(screen.getByLabelText("Enabled"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
