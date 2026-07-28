import { chmod, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type APIRequestContext } from "@playwright/test";

const TOKEN_KEY = "symphony.tracker.token";
const TOKEN = "agent-e2e-token";
const SECRET_SENTINEL = "agent-e2e-secret-must-never-leak";
const agents = ["claude", "codex", "cursor", "opencode"] as const;

interface AgentToolResponse {
  id: string;
  source: { value: string; preferred: string };
  status: { version: string | null; path: string };
}

function headers() {
  return { authorization: `Bearer ${TOKEN}` };
}

async function agentTools(request: APIRequestContext) {
  const response = await request.get("/api/tracker/v1/settings/agents/tools", {
    headers: headers(),
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data.tools as AgentToolResponse[];
}

async function fixtureControl(
  request: APIRequestContext,
  values: { version?: string; mode?: string },
) {
  const baseURL = process.env.SYMPHONY_AGENT_E2E_FIXTURE_URL;
  expect(baseURL, "fixture URL from the disposable harness").toBeTruthy();
  const response = await request.post(`${baseURL}/control`, { data: values });
  expect(response.ok()).toBeTruthy();
}

test.describe("isolated agent lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [TOKEN_KEY, TOKEN] as const,
    );
  });

  test("installs all providers, recovers fallback, and manages isolated accounts", async ({
    page,
    request,
  }, testInfo) => {
    const dataRoot = process.env.SYMPHONY_AGENT_E2E_DATA_ROOT;
    expect(dataRoot, "disposable agent data root").toBeTruthy();

    await page.goto("/tracker/settings/agents/codex");
    await expect(
      page.getByText("Managed preferred; using System PATH"),
    ).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "Automatic CLI updates" }),
    ).toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: "Automatic account failover" }),
    ).not.toBeChecked();

    await page.getByRole("button", { name: "Update CLI" }).click();
    await expect(page.getByText(/^Managed isolated \(/)).toBeVisible();

    for (const agent of agents.filter((agent) => agent !== "codex")) {
      const response = await request.post(
        `/api/tracker/v1/settings/agents/${agent}/install`,
        {
          headers: headers(),
        },
      );
      expect(response.ok(), `${agent} managed install`).toBeTruthy();
    }

    let tools = await agentTools(request);
    for (const agent of agents) {
      const tool = tools.find((entry) => entry.id === agent)!;
      expect(tool.source.value, `${agent} effective source`).toBe("managed");
      expect(tool.source.preferred, `${agent} preferred source`).toBe(
        "managed",
      );
      expect(tool.status.version).toContain("1.0.0");
      expect(
        path.resolve(tool.status.path).startsWith(path.resolve(dataRoot!)),
      ).toBeTruthy();
      expect(
        (await stat(tool.status.path)).mode & 0o111,
        `${agent} executable mode`,
      ).not.toBe(0);
    }

    for (const account of [
      { id: "personal", label: "Personal" },
      { id: "work", label: "Work" },
    ]) {
      const response = await request.post(
        "/api/tracker/v1/settings/agents/codex/accounts",
        {
          headers: headers(),
          data: {
            ...account,
            authentication_status: "authenticated",
            access_token: SECRET_SENTINEL,
          },
        },
      );
      expect(response.status()).toBe(201);
      expect(await response.text()).not.toContain(SECRET_SENTINEL);
    }

    const makeDefault = await request.put(
      "/api/tracker/v1/settings/agents/codex/accounts/personal/default",
      { headers: headers() },
    );
    expect(makeDefault.ok()).toBeTruthy();

    const credentialPath = path.join(
      dataRoot!,
      "codex",
      "accounts",
      "personal",
      "home",
      "fixture-credentials.json",
    );
    await writeFile(
      credentialPath,
      JSON.stringify({ token: SECRET_SENTINEL }),
      { mode: 0o600 },
    );

    await page.reload();
    await expect(
      page.getByText("Personal", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText("Work", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Use Work by default" }).click();
    await expect(page.getByText("Default", { exact: true })).toBeVisible();

    const failover = page.getByRole("checkbox", {
      name: "Automatic account failover",
    });
    await failover.check();
    await expect(failover).toBeChecked();
    const loadedSettings = await request.get("/api/tracker/v1/settings", {
      headers: headers(),
    });
    expect(
      (await loadedSettings.json()).data.agent_cli.codex.failover_enabled,
    ).toBe(true);

    const autoUpdate = page.getByRole("checkbox", {
      name: "Automatic CLI updates",
    });
    await autoUpdate.uncheck();
    await expect(autoUpdate).not.toBeChecked();
    const disabledUpdateSettings = await request.get(
      "/api/tracker/v1/settings",
      {
        headers: headers(),
      },
    );
    expect(
      (await disabledUpdateSettings.json()).data.agent_cli.codex.auto_update,
    ).toBe(false);
    await autoUpdate.check();
    await expect(autoUpdate).toBeChecked();

    const source = page.getByRole("combobox", { name: "CLI source" });
    await source.selectOption("path");
    await expect(page.getByText(/^System PATH \(/)).toBeVisible();
    await source.selectOption("managed");
    await expect(page.getByText(/^Managed isolated \(/)).toBeVisible();

    tools = await agentTools(request);
    const codex = tools.find((entry) => entry.id === "codex")!;
    const versionRoot = path.dirname(codex.status.path);
    await rm(versionRoot, { recursive: true, force: true });

    await page.reload();
    await expect(
      page.getByText("Managed preferred; using System PATH"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Repair" }).click();
    await expect(page.getByText(/^Managed isolated \(/)).toBeVisible();

    await fixtureControl(request, {
      version: "2.0.0",
      mode: "checksum_mismatch",
    });
    const failedUpdate = await request.post(
      "/api/tracker/v1/settings/agents/codex/update",
      {
        headers: headers(),
      },
    );
    expect(failedUpdate.status()).toBe(422);

    tools = await agentTools(request);
    expect(
      tools.find((entry) => entry.id === "codex")!.status.version,
    ).toContain("1.0.0");

    await fixtureControl(request, { version: "2.0.0", mode: "ok" });
    const update = await request.post(
      "/api/tracker/v1/settings/agents/codex/update",
      {
        headers: headers(),
      },
    );
    expect(update.ok()).toBeTruthy();

    tools = await agentTools(request);
    expect(
      tools.find((entry) => entry.id === "codex")!.status.version,
    ).toContain("2.0.0");

    const accounts = await request.get(
      "/api/tracker/v1/settings/agents/codex/accounts",
      {
        headers: headers(),
      },
    );
    expect(await accounts.text()).not.toContain(SECRET_SENTINEL);
    expect(await readFile(credentialPath, "utf8")).toContain(SECRET_SENTINEL);
    await chmod(credentialPath, 0o600);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await expect(
      page.getByText("Personal", { exact: true }).first(),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("agent-cli-lifecycle-desktop.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole("checkbox", { name: "Automatic CLI updates" }),
    ).toBeVisible();
    await page.getByTestId("agent-tool-settings").screenshot({
      path: testInfo.outputPath("agent-cli-lifecycle-mobile.png"),
    });
  });
});
