import { describe, expect, it } from "vitest";

import {
  buildKbDocumentPageIndex,
  linkifyExistingKbDocumentPaths,
  resolveKbDocumentLinkTarget,
} from "@/lib/kbDocumentLinks";
import type { KbTreeNode } from "@/types/knowledgeBase";

function page(path: string, title = path): KbTreeNode {
  return {
    type: "page",
    name: path.split("/").pop() ?? path,
    path,
    title,
    order: null,
    favorite: false,
    children: [],
  };
}

function folder(path: string, children: KbTreeNode[]): KbTreeNode {
  return {
    type: "folder",
    name: path,
    path,
    title: path,
    order: null,
    favorite: false,
    children,
  };
}

describe("buildKbDocumentPageIndex", () => {
  it("indexes page paths by repo", () => {
    const index = buildKbDocumentPageIndex({
      back: [folder("market", [page("market/spec.md", "Spec")])],
      web: [page("guides/setup.md", "Setup")],
    });

    expect(index.get("market/spec.md")).toEqual([{ repoSlug: "back", path: "market/spec.md" }]);
    expect(index.get("guides/setup.md")).toEqual([{ repoSlug: "web", path: "guides/setup.md" }]);
  });
});

describe("resolveKbDocumentLinkTarget", () => {
  const index = buildKbDocumentPageIndex({
    back: [page("market/spec.md")],
    api: [page("market/spec.md")],
  });

  it("resolves docs-prefixed references to existing pages", () => {
    expect(resolveKbDocumentLinkTarget("docs/market/spec.md", index, "macro-markets")).toEqual({
      path: "market/spec.md",
      repoSlug: "back",
      href: "/projects/macro-markets/kb/back/market/spec.md",
    });
  });

  it("prefers the preferred repo when the path exists in multiple repos", () => {
    expect(
      resolveKbDocumentLinkTarget("docs/market/spec.md", index, "macro-markets", "api"),
    ).toMatchObject({ repoSlug: "api", path: "market/spec.md" });
  });

  it("returns null for missing pages", () => {
    expect(resolveKbDocumentLinkTarget("docs/missing.md", index, "macro-markets")).toBeNull();
  });
});

describe("linkifyExistingKbDocumentPaths", () => {
  const index = buildKbDocumentPageIndex({
    back: [page("market/spec.md"), page("market/plan.md")],
  });
  const resolve = (raw: string) => resolveKbDocumentLinkTarget(raw, index, "macro-markets");

  it("wraps bare existing paths and leaves missing paths alone", () => {
    const input = "See docs/market/spec.md and docs/market/missing.md please.";
    expect(linkifyExistingKbDocumentPaths(input, resolve)).toBe(
      "See [docs/market/spec.md](docs/market/spec.md) and docs/market/missing.md please.",
    );
  });

  it("does not rewrite paths that are already markdown link targets", () => {
    const input = "Open [Spec](docs/market/spec.md) now.";
    expect(linkifyExistingKbDocumentPaths(input, resolve)).toBe(input);
  });

  it("stays fast and lossless on large text without markdown references", () => {
    const input = "x".repeat(200_000);

    const start = performance.now();
    const output = linkifyExistingKbDocumentPaths(input, resolve);
    const elapsedMs = performance.now() - start;

    expect(output).toBe(input);
    expect(elapsedMs).toBeLessThan(250);
  });
});
