import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WarmUpBanner } from "@/components/devenv/WarmUpBanner";

describe("WarmUpBanner", () => {
  it("shows the prepare CTA when status is never", () => {
    render(<WarmUpBanner status="never" onPrepare={() => {}} />);
    expect(screen.getByRole("button", { name: /preparar ambiente/i })).toBeInTheDocument();
  });

  it("shows a failure message when the last warm-up failed", () => {
    render(<WarmUpBanner status="failed" onPrepare={() => {}} />);
    expect(screen.getByText(/falhou/i)).toBeInTheDocument();
  });

  it("disables the button while running", () => {
    render(<WarmUpBanner status="running" onPrepare={() => {}} />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("renders nothing when succeeded", () => {
    const { container } = render(<WarmUpBanner status="succeeded" onPrepare={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("calls onPrepare when clicked", async () => {
    const onPrepare = vi.fn();
    render(<WarmUpBanner status="never" onPrepare={onPrepare} />);
    await userEvent.click(screen.getByRole("button", { name: /preparar ambiente/i }));
    expect(onPrepare).toHaveBeenCalledOnce();
  });
});
