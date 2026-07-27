import { test as base, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = process.env.SYMPHONY_NAV_FILE || "test-results/symphony-navigations.json";

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const navigations: string[] = [];

    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      const url = frame.url();
      if (url && !url.startsWith("about:") && !url.startsWith("data:")) {
        navigations.push(url);
      }
    });

    await use(page);

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    let all: Record<string, string[]> = {};
    try {
      all = JSON.parse(fs.readFileSync(OUT, "utf8")) as Record<string, string[]>;
    } catch {
      all = {};
    }
    all[testInfo.titlePath.join(" > ")] = navigations;
    fs.writeFileSync(OUT, JSON.stringify(all, null, 2));
  },
});

export { expect };
