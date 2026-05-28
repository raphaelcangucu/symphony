import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CloneProgressBar } from "@/components/templates/CloneProgressBar";

describe("CloneProgressBar", () => {
  it("renders running state", () => {
    render(
      <CloneProgressBar
        state={{ jobs: { "1": { repositoryId: "1", status: "running", githubFullName: "g/api" } }, allSucceeded: false, anyFailed: false, inProgressCount: 1 }}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText(/Cloning/i)).toBeInTheDocument();
  });

  it("hides when all succeeded", () => {
    const { container } = render(
      <CloneProgressBar
        state={{ jobs: { "1": { repositoryId: "1", status: "succeeded" } }, allSucceeded: true, anyFailed: false, inProgressCount: 0 }}
        onRetry={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
