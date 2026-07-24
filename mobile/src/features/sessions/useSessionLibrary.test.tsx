import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { PropsWithChildren } from "react";

import type { TrackerClient } from "@/api/contracts";

import { useSessionLibrary } from "./useSessionLibrary";

function createClient(): jest.Mocked<TrackerClient> {
  return {
    health: jest.fn(),
    viewer: jest.fn().mockResolvedValue({ id: "viewer-1", name: "Raphael" }),
    projects: jest.fn().mockResolvedValue([
      { id: "project-1", slug: "symphony", name: "Symphony" },
      { id: "project-2", slug: "api", name: "API" },
    ]),
    threads: jest.fn().mockResolvedValue([
      {
        id: 42,
        scope: "project_session",
        projectSlug: "symphony",
        projectName: "Symphony",
        issueIdentifier: null,
        workspacePath: "/work/symphony",
        title: "Mobile session library",
        status: "running",
        preview: "Implement the clean mobile experience",
        updatedAt: "2026-07-24T02:00:00Z",
        agentKind: "codex",
        needsReview: false,
      },
    ]),
    projectSessions: jest.fn().mockResolvedValue({
      sessions: [],
      nextCursor: null,
    }),
    assistantCatalog: jest.fn(),
    createThread: jest.fn(),
  };
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useSessionLibrary", () => {
  it("loads projects, threads, and each project's session rows with profile-bound keys", async () => {
    const client = createClient();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    });
    const { result } = renderHook(
      () =>
        useSessionLibrary({
          client,
          profileId: "remote-1",
          query: "",
          collapsedProjectSlugs: new Set(),
        }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(client.projects).toHaveBeenCalledTimes(1);
    expect(client.viewer).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(client.threads).toHaveBeenCalledWith(
      { scopes: ["freeform", "project_session", "issue_session"], limit: 100 },
      expect.any(AbortSignal),
    );
    expect(client.projectSessions).toHaveBeenCalledTimes(2);
    expect(client.projectSessions).toHaveBeenCalledWith(
      "symphony",
      { limit: 50 },
      expect.any(AbortSignal),
    );
    expect(queryClient.getQueryData(["session-library", "remote-1", "projects"])).toBeTruthy();
    expect(result.current.groups.flatMap((group) => group.sessions)).toHaveLength(1);
  });

  it("filters cached rows without refetching", async () => {
    const client = createClient();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    });
    const initialProps = { query: "" };
    const { result, rerender } = renderHook(
      ({ query }: typeof initialProps) =>
        useSessionLibrary({
          client,
          profileId: "remote-1",
          query,
          collapsedProjectSlugs: new Set(),
        }),
      { initialProps, wrapper: createWrapper(queryClient) },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ query: "does not match" });

    expect(result.current.groups).toEqual([]);
    expect(client.projects).toHaveBeenCalledTimes(1);
    expect(client.viewer).toHaveBeenCalledTimes(1);
    expect(client.threads).toHaveBeenCalledTimes(1);
    expect(client.projectSessions).toHaveBeenCalledTimes(2);
  });

  it("surfaces a refresh action after a recoverable request failure", async () => {
    const client = createClient();
    client.projects.mockRejectedValueOnce(new Error("Tracker offline"));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    });
    const { result } = renderHook(
      () =>
        useSessionLibrary({
          client,
          profileId: "remote-1",
          query: "",
          collapsedProjectSlugs: new Set(),
        }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.error).toBe("Tracker offline"));
    client.projects.mockResolvedValueOnce([
      { id: "project-1", slug: "symphony", name: "Symphony" },
    ]);
    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => expect(result.current.error).toBeNull());
  });
});
