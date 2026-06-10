import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BlockedBanner } from "../BlockedBanner";

describe("BlockedBanner", () => {
  it("renders an alert when the issue has the symphony:blocked label", () => {
    render(<BlockedBanner labels={["bug", "symphony:blocked"]} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Run blocked");
    expect(alert.textContent).toContain("publish gate");
  });

  it("renders nothing without the label", () => {
    const { container } = render(<BlockedBanner labels={["bug"]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
