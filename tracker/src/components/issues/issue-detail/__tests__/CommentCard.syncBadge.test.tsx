import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SyncBadge } from "../CommentCard";

describe("SyncBadge", () => {
  it("shows pending state", () => {
    render(<SyncBadge syncStatus="pending" />);
    expect(screen.getByText(/syncing/i)).toBeInTheDocument();
  });

  it("shows conflict state", () => {
    render(<SyncBadge syncStatus="conflict" />);
    expect(screen.getByText(/sync conflict/i)).toBeInTheDocument();
  });

  it("shows error state", () => {
    render(<SyncBadge syncStatus="error" />);
    expect(screen.getByText(/sync failed/i)).toBeInTheDocument();
  });

  it("renders nothing when synced", () => {
    const { container } = render(<SyncBadge syncStatus="synced" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing without a status", () => {
    const { container } = render(<SyncBadge syncStatus={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
