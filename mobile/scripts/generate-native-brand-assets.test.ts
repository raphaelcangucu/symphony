import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const mobileRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(mobileRoot, "..");

describe("native Dev10x brand assets", () => {
  it("generates deterministic native-safe icons and a centered splash from canonical sources", () => {
    expect(sha256(resolve(repoRoot, "tracker/public/dev10x_icon.png"))).toBe(
      "59731a4e0d08e514075af55efdf7c3f94084a583132a59efd72b67a42119af8a",
    );
    expect(sha256(resolve(repoRoot, "tracker/public/dev10x_logo_white.png"))).toBe(
      "950c1b1e091e06a16c43f31d5a13552fef8fab336e88552b5684b3645c798aec",
    );

    const output = mkdtempSync(resolve(tmpdir(), "dev10x-native-"));
    execFileSync(process.execPath, [
      resolve(import.meta.dirname, "generate-native-brand-assets.mjs"),
      "--output-dir",
      output,
    ]);

    expect(imageInfo(resolve(output, "icon-ios.png"))).toMatchObject({
      width: 1024,
      height: 1024,
      opaque: true,
    });
    expect(imageInfo(resolve(output, "icon-android.png"))).toMatchObject({
      width: 1024,
      height: 1024,
      opaque: true,
    });
    expect(imageInfo(resolve(output, "adaptive-foreground.png"))).toMatchObject({
      width: 1024,
      height: 1024,
      opaque: false,
    });
    expect(imageInfo(resolve(output, "adaptive-monochrome.png"))).toMatchObject({
      width: 432,
      height: 432,
      opaque: false,
    });
    expect(imageInfo(resolve(output, "splash.png"))).toMatchObject({
      width: 1284,
      height: 2778,
      opaque: true,
    });

    const foreground = visibleBounds(resolve(output, "adaptive-foreground.png"));
    expect(foreground.width).toBeLessThanOrEqual(676);
    expect(foreground.height).toBeLessThanOrEqual(676);
    expect(foreground.x).toBeGreaterThanOrEqual(174);
    expect(foreground.y).toBeGreaterThanOrEqual(174);
    expect(foreground.x + foreground.width).toBeLessThanOrEqual(850);
    expect(foreground.y + foreground.height).toBeLessThanOrEqual(850);

    const splash = nonBackgroundBounds(resolve(output, "splash.png"));
    expect(Math.abs(splash.x + splash.width / 2 - 642)).toBeLessThanOrEqual(2);
    expect(Math.abs(splash.y + splash.height / 2 - 1389)).toBeLessThanOrEqual(2);
  });

  it("configures every native icon and holds the splash until storage hydration", () => {
    const config = readFileSync(resolve(mobileRoot, "app.config.ts"), "utf8");
    for (const expected of [
      "dev10x-native/icon-ios.png",
      "dev10x-native/icon-android.png",
      "dev10x-native/adaptive-foreground.png",
      "dev10x-native/adaptive-monochrome.png",
      "dev10x-native/splash.png",
      "expo-splash-screen",
    ]) {
      expect(config).toContain(expected);
    }

    const layout = readFileSync(resolve(mobileRoot, "app/_layout.tsx"), "utf8");
    expect(layout).toContain("preventAutoHideAsync");
    expect(layout).toContain("if (!hydrated)");
    expect(layout).toContain("hideAsync");
  });
});

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function imageInfo(path: string): { width: number; height: number; opaque: boolean } {
  const [dimensions, opaque] = execFileSync("identify", ["-format", "%wx%h %[opaque]", path], {
    encoding: "utf8",
  })
    .trim()
    .split(" ");
  const [width, height] = dimensions.split("x").map(Number);
  return { width, height, opaque: opaque === "true" };
}

function visibleBounds(path: string) {
  return geometry(
    execFileSync(
      "convert",
      [path, "-alpha", "extract", "-threshold", "0", "-format", "%@", "info:"],
      { encoding: "utf8" },
    ),
  );
}

function nonBackgroundBounds(path: string) {
  return geometry(
    execFileSync(
      "convert",
      [
        path,
        "-fuzz",
        "3%",
        "-transparent",
        "#090A0F",
        "-alpha",
        "extract",
        "-threshold",
        "0",
        "-format",
        "%@",
        "info:",
      ],
      { encoding: "utf8" },
    ),
  );
}

function geometry(value: string) {
  const match = value.trim().match(/^(\d+)x(\d+)\+(\d+)\+(\d+)$/);
  if (!match) throw new Error(`Invalid ImageMagick geometry: ${value}`);
  return {
    width: Number(match[1]),
    height: Number(match[2]),
    x: Number(match[3]),
    y: Number(match[4]),
  };
}
