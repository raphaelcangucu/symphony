import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import appConfig from "../../app.config";
import { APP_BRAND } from "./dev10x";

const root = resolve(__dirname, "../..");
const forbiddenVisibleCopy = [
  /["'`]Orca["'`]/,
  /orca:\/\/pair/i,
  /Pair Desktop/,
  /Orca Mobile/,
  /marine creature/i,
  /Update Orca/,
  /Orca desktop/,
  /stablyai\/orca/i,
  /onorca\.dev/i,
  /@orca_build/i,
  /desktop Orca/,
  /Orca browser/,
  /Orca could/,
  /Repository not in Orca/,
  /in Orca\./,
  /ORCA\.YAML/,
];

describe("visible Dev10x brand", () => {
  it("does not expose the upstream Orca brand in routes or components", () => {
    const violations = sourceFiles(["app", "src/dev10x"]).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return forbiddenVisibleCopy
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${file.slice(root.length + 1)}: ${pattern.source}`);
    });

    expect(violations).toEqual([]);
  });

  it("keeps the app identity and native permissions branded Dev10x", () => {
    expect(APP_BRAND).toBe("Dev10x");
    expect(appConfig.name).toBe("Dev10x");
    expect(appConfig.scheme).toBe("symphony");

    const serializedPlugins = JSON.stringify(appConfig.plugins);
    for (const permission of [
      "Allow Dev10x to scan",
      "Allow Dev10x to turn",
      "Allow Dev10x to recognize",
    ]) {
      expect(serializedPlugins).toContain(permission);
    }
  });
});

function sourceFiles(relativeRoots: string[]): string[] {
  return relativeRoots.flatMap((relativeRoot) => walk(resolve(root, relativeRoot)));
}

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) return walk(path);
    if (!/\.(ts|tsx)$/.test(entry) || /\.test\.(ts|tsx)$/.test(entry)) return [];
    if (entry.endsWith(".generated.ts")) return [];
    return [path];
  });
}
