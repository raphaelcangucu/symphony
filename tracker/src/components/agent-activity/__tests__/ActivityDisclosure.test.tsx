import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ActivityDisclosure } from "@/components/agent-activity/ActivityDisclosure";

function disclosure(
  overrides: Partial<React.ComponentProps<typeof ActivityDisclosure>> = {},
) {
  return (
    <ActivityDisclosure
      icon={<span aria-hidden>•</span>}
      label="Read file"
      metadata={<span>src/app.ts</span>}
      details={<p>File contents</p>}
      {...overrides}
    />
  );
}

describe("ActivityDisclosure", () => {
  it("starts closed and expands with native click and keyboard behavior", async () => {
    const user = userEvent.setup();
    render(disclosure());

    const summary = screen.getByRole("button", { name: /Read file.*src\/app\.ts/i });
    expect(summary).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("File contents")).not.toBeInTheDocument();

    await user.click(summary);
    expect(summary).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("File contents")).toBeInTheDocument();

    await user.click(summary);
    expect(summary).toHaveAttribute("aria-expanded", "false");

    summary.focus();
    await user.keyboard("{Enter}");
    expect(summary).toHaveAttribute("aria-expanded", "true");
  });

  it.each([null, undefined, false, ""])(
    "renders a non-interactive row when details are %p",
    (details) => {
      render(disclosure({ details }));

      expect(screen.queryByRole("button", { name: /Read file/i })).not.toBeInTheDocument();
      expect(screen.getByText("Read file").closest("[aria-expanded]")).toBeNull();
    },
  );

  it("keeps running details closed and exposes busy status accessibly", () => {
    render(
      disclosure({
        status: "running",
        statusLabel: "running",
      }),
    );

    const summary = screen.getByRole("button", { name: /running/i });
    expect(summary).toHaveAttribute("aria-busy", "true");
    expect(summary).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.queryByText("File contents")).not.toBeInTheDocument();
  });

  it("keeps failed details closed and makes failure obvious in the summary", () => {
    render(
      disclosure({
        status: "failed",
        statusLabel: "failed",
      }),
    );

    const summary = screen.getByRole("button", { name: /failed/i });
    expect(summary).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("failed")).toHaveClass("text-destructive");
    expect(screen.queryByText("File contents")).not.toBeInTheDocument();
  });

  it("supports controlled expansion without mutating internal state", async () => {
    const user = userEvent.setup();
    const onExpandedChange = vi.fn();
    const { rerender } = render(
      disclosure({ expanded: false, onExpandedChange }),
    );
    const summary = screen.getByRole("button", { name: /Read file/i });

    await user.click(summary);
    expect(onExpandedChange).toHaveBeenCalledWith(true);
    expect(summary).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("File contents")).not.toBeInTheDocument();

    rerender(disclosure({ expanded: true, onExpandedChange }));
    expect(summary).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("File contents")).toBeInTheDocument();

    await user.click(summary);
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);
  });
});
