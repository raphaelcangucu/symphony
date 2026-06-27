import type { Mermaid, MermaidConfig } from "mermaid";

/**
 * Mermaid is heavy (hundreds of KB) and only needed when a page actually
 * contains a diagram, so the library is imported lazily on first render and
 * cached. The module also owns a single global `initialize` call: mermaid keeps
 * its configuration in module-level state, so re-initializing per render is the
 * supported way to switch themes between light/dark.
 */

const MERMAID_FONT_FAMILY =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export type MermaidTheme = "light" | "dark";

export type MermaidRenderResult =
  | { status: "ok"; svg: string }
  | { status: "empty" }
  | { status: "error"; message: string };

let mermaidModule: Promise<Mermaid> | null = null;
let lastAppliedTheme: MermaidTheme | null = null;
let renderCounter = 0;

function baseConfig(theme: MermaidTheme): MermaidConfig {
  return {
    startOnLoad: false,
    // `strict` sanitizes diagram labels so user/AI authored markdown cannot
    // inject script or arbitrary HTML through a diagram definition.
    securityLevel: "strict",
    theme: theme === "dark" ? "dark" : "default",
    fontFamily: MERMAID_FONT_FAMILY,
  };
}

async function loadMermaid(): Promise<Mermaid> {
  if (!mermaidModule) {
    mermaidModule = import("mermaid").then((mod) => mod.default);
  }
  return mermaidModule;
}

/** Reads the active app theme from the documentElement class ThemeToggle sets. */
export function detectMermaidTheme(): MermaidTheme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function normalizeError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (typeof error === "string" && error.trim().length > 0) return error;
  return "Invalid diagram definition";
}

/**
 * Renders a Mermaid diagram definition to an SVG string. Never throws: parse
 * failures are validated up front (so mermaid does not inject an error node into
 * `document.body`) and any unexpected failure is returned as an error result.
 */
export async function renderMermaid(
  definition: string,
  theme: MermaidTheme,
): Promise<MermaidRenderResult> {
  const source = definition.trim();
  if (source.length === 0) return { status: "empty" };

  let mermaid: Mermaid;
  try {
    mermaid = await loadMermaid();
  } catch (error) {
    return { status: "error", message: normalizeError(error) };
  }

  if (lastAppliedTheme !== theme) {
    mermaid.initialize(baseConfig(theme));
    lastAppliedTheme = theme;
  }

  try {
    const valid = await mermaid.parse(source, { suppressErrors: true });
    if (valid === false) {
      return { status: "error", message: "Invalid diagram definition" };
    }
  } catch (error) {
    return { status: "error", message: normalizeError(error) };
  }

  renderCounter += 1;
  const renderId = `kb-mermaid-${renderCounter}`;

  try {
    const { svg } = await mermaid.render(renderId, source);
    return { status: "ok", svg };
  } catch (error) {
    return { status: "error", message: normalizeError(error) };
  }
}
