import { afterEach, describe, expect, it } from "vitest";

import {
  applyTrackerDocumentBranding,
  getTrackerBranding,
  resolveTrackerAssetPath,
} from "@/lib/branding";

describe("getTrackerBranding", () => {
  afterEach(() => {
    delete window.__SYMPHONY_BRANDING__;
  });

  it("defaults to Dev10x branding", () => {
    expect(getTrackerBranding()).toMatchObject({
      productName: "Dev10x",
      trackerTitle: "Dev10x",
      iconPath: "dev10x_icon.png",
      faviconPath: "favicon.png",
    });
  });

  it("merges injected window branding", () => {
    window.__SYMPHONY_BRANDING__ = {
      productName: "Acme",
      iconPath: "acme.png",
    };

    expect(getTrackerBranding()).toMatchObject({
      productName: "Acme",
      trackerTitle: "Dev10x",
      iconPath: "acme.png",
    });
  });
});

describe("resolveTrackerAssetPath", () => {
  it("joins base url and asset name", () => {
    expect(resolveTrackerAssetPath("/tracker/", "favicon.svg")).toBe("/tracker/favicon.svg");
    expect(resolveTrackerAssetPath("/", "dev10x_icon.png")).toBe("/dev10x_icon.png");
  });

  it("rejects empty or unsafe asset names", () => {
    expect(() => resolveTrackerAssetPath("/tracker/", "")).toThrow(/must not be empty/);
    expect(() => resolveTrackerAssetPath("/tracker/", "../x.png")).toThrow(/Unsafe/);
  });
});

describe("applyTrackerDocumentBranding", () => {
  afterEach(() => {
    delete window.__SYMPHONY_BRANDING__;
    document.title = "";
    document.head.querySelectorAll("link[rel='icon']").forEach((node) => node.remove());
  });

  it("sets document title and favicon href", () => {
    const link = document.createElement("link");
    link.rel = "icon";
    link.href = "/tracker/old.svg";
    document.head.appendChild(link);

    applyTrackerDocumentBranding({
      productName: "Acme",
      trackerTitle: "Acme Board",
      iconPath: "acme.png",
      faviconPath: "acme.svg",
      logoColorPath: "c.png",
      logoBlackPath: "b.png",
      logoWhitePath: "w.png",
    });

    expect(document.title).toBe("Acme Board");
    expect(link.getAttribute("href")).toBe(
      resolveTrackerAssetPath(import.meta.env.BASE_URL, "acme.svg"),
    );
  });
});
