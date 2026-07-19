import { describe, expect, it } from "vitest";

import {
  settingsBackupsPath,
  settingsDockerPath,
  settingsPath,
  settingsTemplatesPath,
} from "@/lib/settingsRoutes";

describe("settingsRoutes", () => {
  it("builds settings paths", () => {
    expect(settingsPath()).toBe("/settings");
    expect(settingsTemplatesPath()).toBe("/settings/templates");
    expect(settingsTemplatesPath("my-template")).toBe("/settings/templates/my-template");
    expect(settingsBackupsPath()).toBe("/settings/backups");
    expect(settingsDockerPath()).toBe("/settings/docker");
  });
});
