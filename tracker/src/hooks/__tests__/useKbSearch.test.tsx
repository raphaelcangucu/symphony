import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as service from "@/services/knowledgeBase";
import { useKbSearch } from "@/hooks/useKbSearch";

afterEach(() => vi.restoreAllMocks());

describe("useKbSearch", () => {
  it("debounces and returns results for queries >= 2 chars", async () => {
    const spy = vi.spyOn(service, "searchProject").mockResolvedValue([
      { projectSlug: "acme", repoSlug: "web", path: "a.md", title: "A", snippet: "x", rank: 1 },
    ]);

    const { result, rerender } = renderHook(({ q }) => useKbSearch("acme", q), {
      initialProps: { q: "a" },
    });
    expect(result.current.results).toEqual([]);
    expect(spy).not.toHaveBeenCalled();

    rerender({ q: "auth" });
    await waitFor(() => expect(spy).toHaveBeenCalledWith("acme", "auth", {}));
    await waitFor(() => expect(result.current.results).toHaveLength(1));
  });

  it("passes a repo filter when provided", async () => {
    const spy = vi.spyOn(service, "searchProject").mockResolvedValue([]);
    const { rerender } = renderHook(({ q }) => useKbSearch("acme", q, "web"), {
      initialProps: { q: "x" },
    });
    rerender({ q: "llama" });
    await waitFor(() => expect(spy).toHaveBeenCalledWith("acme", "llama", { repo: "web" }));
  });
});
