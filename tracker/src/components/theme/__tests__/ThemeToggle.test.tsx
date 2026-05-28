import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeToggle, TRACKER_THEME_STORAGE_KEY } from "@/components/theme/ThemeToggle";

type MatchMediaListener = (event: MediaQueryListEvent) => void;

let prefersDark = false;
let matchMediaListeners: MatchMediaListener[] = [];
const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");

function dispatchSystemThemeChange(matches: boolean) {
  prefersDark = matches;
  matchMediaListeners.forEach((listener) => listener({ matches } as MediaQueryListEvent));
}

function installMatchMediaMock() {
  matchMediaListeners = [];
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: prefersDark,
      media: query,
      onchange: null,
      addEventListener: vi.fn((eventName: string, listener: MatchMediaListener) => {
        if (eventName === "change") matchMediaListeners.push(listener);
      }),
      removeEventListener: vi.fn((eventName: string, listener: MatchMediaListener) => {
        if (eventName === "change") {
          matchMediaListeners = matchMediaListeners.filter((currentListener) => currentListener !== listener);
        }
      }),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function expectRootTheme(theme: "light" | "dark") {
  expect(document.documentElement.classList.contains(theme)).toBe(true);
  expect(document.documentElement.classList.contains(theme === "light" ? "dark" : "light")).toBe(false);
}

async function openThemeMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Toggle theme" }));
  await screen.findByRole("menuitem", { name: "Light" });
}

describe("ThemeToggle", () => {
  afterEach(() => {
    if (originalLocalStorageDescriptor) {
      Object.defineProperty(window, "localStorage", originalLocalStorageDescriptor);
    }
  });

  beforeEach(() => {
    prefersDark = false;
    installMatchMediaMock();
    window.localStorage.clear();
    document.documentElement.classList.remove("light", "dark");
  });

  it("applies a valid stored theme on initial render", () => {
    window.localStorage.setItem(TRACKER_THEME_STORAGE_KEY, "dark");

    render(<ThemeToggle />);

    expectRootTheme("dark");
  });

  it("falls back to system when the stored theme is invalid", () => {
    window.localStorage.setItem(TRACKER_THEME_STORAGE_KEY, "sepia");

    render(<ThemeToggle />);

    expect(window.localStorage.getItem(TRACKER_THEME_STORAGE_KEY)).toBe("sepia");
    expectRootTheme("light");
  });

  it("falls back to system when no stored theme exists", () => {
    dispatchSystemThemeChange(true);

    render(<ThemeToggle />);

    expectRootTheme("dark");
  });

  it("falls back to system when localStorage is unavailable", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("localStorage is unavailable");
      },
    });

    render(<ThemeToggle />);

    expectRootTheme("light");
  });

  it("selecting Light, Dark, and System stores the choice and updates the root class", async () => {
    dispatchSystemThemeChange(true);
    render(<ThemeToggle />);

    await openThemeMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Light" }));
    expect(window.localStorage.getItem(TRACKER_THEME_STORAGE_KEY)).toBe("light");
    expectRootTheme("light");

    await openThemeMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Dark" }));
    expect(window.localStorage.getItem(TRACKER_THEME_STORAGE_KEY)).toBe("dark");
    expectRootTheme("dark");

    await openThemeMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "System" }));
    await waitFor(() => expect(window.localStorage.getItem(TRACKER_THEME_STORAGE_KEY)).toBe("system"));
    expectRootTheme("dark");
  });

  it("tracks system color-scheme changes while System is selected", () => {
    render(<ThemeToggle />);
    expectRootTheme("light");

    dispatchSystemThemeChange(true);

    expectRootTheme("dark");
  });

  it("stops tracking system color-scheme changes after selecting a fixed theme", async () => {
    render(<ThemeToggle />);

    await openThemeMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Light" }));
    expectRootTheme("light");

    dispatchSystemThemeChange(true);

    expectRootTheme("light");
  });
});
