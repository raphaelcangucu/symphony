import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ViewerProvider, useViewer } from "@/components/auth/ViewerProvider";
import * as viewerService from "@/services/viewer";

function Probe() {
  const { status, viewer, error } = useViewer();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="login">{viewer?.githubLogin ?? ""}</span>
      <span data-testid="error">{error?.code ?? ""}</span>
    </div>
  );
}

describe("ViewerProvider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads the viewer and exposes status ready", async () => {
    vi.spyOn(viewerService, "fetchViewer").mockResolvedValueOnce({
      githubLogin: "octocat",
      name: null,
      avatarUrl: null,
    });

    render(
      <ViewerProvider>
        <Probe />
      </ViewerProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
    expect(screen.getByTestId("login").textContent).toBe("octocat");
  });

  it("surfaces ViewerNotConfiguredError as status error", async () => {
    const error = new viewerService.ViewerNotConfiguredError("github_token_missing");
    vi.spyOn(viewerService, "fetchViewer").mockRejectedValueOnce(error);

    render(
      <ViewerProvider>
        <Probe />
      </ViewerProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));
    expect(screen.getByTestId("error").textContent).toBe("github_token_missing");
  });
});
