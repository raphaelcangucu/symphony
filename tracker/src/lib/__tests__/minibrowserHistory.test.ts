import { describe, expect, it } from "vitest";

import {
  canGoBack,
  canGoForward,
  createMinibrowserHistory,
  goBack,
  goForward,
  navigateTo,
} from "@/lib/minibrowserHistory";

describe("minibrowserHistory", () => {
  it("creates history at the supplied home URL", () => {
    expect(createMinibrowserHistory("http://localhost:4300/")).toEqual({
      current: "http://localhost:4300/",
      backStack: [],
      forwardStack: [],
    });
  });

  it("navigates to a distinct non-empty URL and clears forward history", () => {
    const home = createMinibrowserHistory("http://localhost:4300/");
    const visited = navigateTo(home, "http://localhost:4300/dashboard");
    const returned = goBack(visited);

    expect(navigateTo(returned, "http://localhost:4300/settings")).toEqual({
      current: "http://localhost:4300/settings",
      backStack: ["http://localhost:4300/"],
      forwardStack: [],
    });
  });

  it("ignores empty and identical navigation requests", () => {
    const history = createMinibrowserHistory("http://localhost:4300/");

    expect(navigateTo(history, "   ")).toBe(history);
    expect(navigateTo(history, "http://localhost:4300/")).toBe(history);
  });

  it("moves between back and forward stacks", () => {
    const home = createMinibrowserHistory("http://localhost:4300/");
    const first = navigateTo(home, "http://localhost:4300/dashboard");
    const second = navigateTo(first, "http://localhost:4300/settings");
    const backed = goBack(second);

    expect(canGoBack(second)).toBe(true);
    expect(canGoForward(second)).toBe(false);
    expect(backed).toEqual({
      current: "http://localhost:4300/dashboard",
      backStack: ["http://localhost:4300/"],
      forwardStack: ["http://localhost:4300/settings"],
    });
    expect(canGoForward(backed)).toBe(true);
    expect(goForward(backed)).toEqual(second);
  });

  it("does not change history when a navigation stack is empty", () => {
    const history = createMinibrowserHistory("http://localhost:4300/");

    expect(goBack(history)).toBe(history);
    expect(goForward(history)).toBe(history);
    expect(canGoBack(history)).toBe(false);
    expect(canGoForward(history)).toBe(false);
  });
});
