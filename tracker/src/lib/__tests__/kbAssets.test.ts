import { describe, expect, it } from "vitest";

import {
  absolutizeKbAssetUrl,
  assetBaseName,
  editorizeKbMarkdown,
  isKbImageAssetPath,
  kbAssetApiPath,
  kbImageMarkdown,
  persistKbMarkdown,
  resolveKbAssetUrl,
  suggestAssetName,
} from "@/lib/kbAssets";

const ctx = {
  projectSlug: "gamba",
  repoSlug: "backend",
  pagePath: "backend/settings.md",
};

describe("kbAssets", () => {
  it("builds a tracker asset URL", () => {
    expect(kbAssetApiPath("gamba", "backend", "assets/abc.png")).toContain(
      "/projects/gamba/kb/repos/backend/assets/assets/abc.png",
    );
  });

  it("resolves a page-relative asset for editor preview", () => {
    const url = resolveKbAssetUrl("../assets/abc.png", ctx);
    expect(url).toContain("/assets/assets/abc.png");
  });

  it("editorizes markdown image links for preview", () => {
    const md = "![logo](../assets/abc.png)";
    const out = editorizeKbMarkdown(md, ctx);
    expect(out).toContain("/kb/repos/backend/assets/assets/abc.png");
  });

  it("persists preview URLs back to relative markdown links", () => {
    const preview = kbImageMarkdown("logo", "assets/abc.png", ctx);
    const out = persistKbMarkdown(`Before\n\n${preview}\n`, ctx);
    expect(out).toContain("![logo](../assets/abc.png)");
  });

  it("editorizes <img> tag src for preview", () => {
    const md = '<img src="../assets/abc.png" alt="logo" style="width: 66%" data-align="center" />';
    const out = editorizeKbMarkdown(md, ctx);
    expect(out).toContain("/kb/repos/backend/assets/assets/abc.png");
    expect(out).toContain("width: 66%");
    expect(out).toContain('data-align="center"');
  });

  it("persists <img> tag src back to a page-relative path", () => {
    const apiUrl = resolveKbAssetUrl("assets/abc.png", ctx);
    const md = `<img src="${apiUrl}" alt="logo" style="width: 66%" data-align="center" />`;
    const out = persistKbMarkdown(md, ctx);
    expect(out).toContain('src="../assets/abc.png"');
    expect(out).toContain("width: 66%");
    expect(out).toContain('data-align="center"');
  });

  it("absolutizes preview URLs to page-relative asset paths", () => {
    const preview = kbImageMarkdown("logo", "assets/abc.png", ctx);
    expect(absolutizeKbAssetUrl(preview.match(/\(([^)]+)\)/)?.[1] ?? "", ctx)).toBe("../assets/abc.png");
  });

  it("detects image asset paths by extension", () => {
    expect(isKbImageAssetPath("assets/diagram.png")).toBe(true);
    expect(isKbImageAssetPath("assets/logo.SVG")).toBe(true);
    expect(isKbImageAssetPath("guides/intro.md")).toBe(false);
    expect(isKbImageAssetPath(null)).toBe(false);
  });

  it("extracts an asset base name without directory or extension", () => {
    expect(assetBaseName("assets/queue-config.png")).toBe("queue-config");
    expect(assetBaseName("logo.jpeg")).toBe("logo");
  });

  it("suggests a friendly name from the current page", () => {
    expect(suggestAssetName("images/daemon-config.md")).toBe("daemon config");
    expect(suggestAssetName(null)).toBe("image");
  });
});
