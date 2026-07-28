import { chmod, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";

const TOKEN_KEY = "symphony.tracker.token";
const TOKEN = "agent-e2e-token";
const SECRET_SENTINEL = [
  "agent",
  "e2e",
  "secret",
  "must",
  "never",
  "leak",
].join("-");
const agents = ["claude", "codex", "cursor", "opencode"] as const;

interface AgentToolResponse {
  id: string;
  source: { value: string; preferred: string; fallback_reason?: string };
  status: { version: string | null; path: string };
  install: { pending_version?: string | null };
}

interface AccountResponse {
  id: string;
  default: boolean;
  usage: null | {
    plan: string | null;
    state: string;
    stale: boolean;
    stale_reason: string | null;
    next_refresh_at: number | null;
  };
}

function headers() {
  return { authorization: `Bearer ${TOKEN}` };
}

async function data(response: APIResponse) {
  return (await response.json()).data;
}

async function agentTools(request: APIRequestContext) {
  const response = await request.get("/api/tracker/v1/settings/agents/tools", {
    headers: headers(),
  });
  expect(response.ok()).toBeTruthy();
  return (await data(response)).tools as AgentToolResponse[];
}

async function accounts(request: APIRequestContext) {
  const response = await request.get(
    "/api/tracker/v1/settings/agents/codex/accounts",
    {
      headers: headers(),
    },
  );
  expect(response.ok()).toBeTruthy();
  return (await data(response)).accounts as AccountResponse[];
}

async function setDefault(request: APIRequestContext, accountId: string) {
  const response = await request.put(
    `/api/tracker/v1/settings/agents/codex/accounts/${accountId}/default`,
    { headers: headers() },
  );
  expect(response.ok()).toBeTruthy();
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

async function runtimeControl(
  request: APIRequestContext,
  operation: string,
  values: Record<string, unknown> = {},
) {
  const baseURL = process.env.SYMPHONY_AGENT_E2E_CONTROL_URL;
  expect(
    baseURL,
    "runtime control URL from the disposable harness",
  ).toBeTruthy();
  return request.post(`${baseURL}/${operation}`, {
    headers: { "x-e2e-token": TOKEN },
    data: values,
  });
}

let usageReportId = 0;

async function reportUsage(
  request: APIRequestContext,
  accountId: string,
  plan: string,
  usedPercent: number,
) {
  usageReportId += 1;
  const response = await request.post("/api/tracker/v1/observability/report", {
    headers: headers(),
    data: {
      runtime_id: `agent-e2e-${accountId}-${usageReportId}`,
      agent_kind: "codex",
      agent_account_id: accountId,
      label: "agent lifecycle e2e",
      snapshot: {
        counts: { running: 1, retrying: 0 },
        running: [],
        retrying: [],
        agent_totals: {},
        rate_limits: {
          limit_name: plan,
          primary: {
            usedPercent,
            windowDurationMins: 300,
            resets_at: 1_900_000_000,
          },
          secondary: {
            usedPercent: Math.min(usedPercent, 80),
            windowDurationMins: 10_080,
            resets_at: 1_900_500_000,
          },
          credits: {
            has_credits: true,
            balance: accountId === "personal" ? 7 : 11,
          },
        },
      },
    },
  });
  expect(response.status()).toBe(202);
}

async function beginUsage(
  request: APIRequestContext,
  accountId: string,
  nowMs: number,
  force = false,
) {
  const response = await runtimeControl(request, "usage/begin", {
    agent: "codex",
    account_id: accountId,
    now_ms: nowMs,
    force,
  });
  expect(response.ok()).toBeTruthy();
  return (await data(response)).generation as number;
}

async function completeUsage(
  request: APIRequestContext,
  input: Record<string, unknown>,
) {
  const response = await runtimeControl(request, "usage/complete", {
    agent: "codex",
    account_id: "work",
    ...input,
  });
  expect(response.ok()).toBeTruthy();
  return (await data(response)).result as string;
}

test.describe("isolated agent lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [TOKEN_KEY, TOKEN] as const,
    );
  });

  test("covers managed CLIs, isolated accounts, usage, and session-boundary failover", async ({
    page,
    request,
  }, testInfo) => {
    const dataRoot = process.env.SYMPHONY_AGENT_E2E_DATA_ROOT;
    const pathBin = process.env.SYMPHONY_AGENT_E2E_PATH_BIN;
    expect(dataRoot, "disposable agent data root").toBeTruthy();
    expect(pathBin, "disposable PATH fixture root").toBeTruthy();

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
        { headers: headers() },
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
      expect((await stat(tool.status.path)).mode & 0o111).not.toBe(0);
    }

    for (const account of [
      { id: "personal", label: "Personal" },
      { id: "work", label: "Work" },
    ]) {
      const response = await request.post(
        "/api/tracker/v1/settings/agents/codex/accounts",
        {
          headers: headers(),
          data: { ...account, authentication_status: "authenticated" },
        },
      );
      expect(response.status()).toBe(201);
    }
    await setDefault(request, "personal");

    const defaultLaunch = await runtimeControl(request, "launch/resolve", {
      agent: "codex",
    });
    expect(defaultLaunch.ok()).toBeTruthy();
    const defaultProvenance = await data(defaultLaunch);
    expect(defaultProvenance.account_id).toBe("personal");
    expect(defaultProvenance.observed_account_home).toBe(
      defaultProvenance.account_home,
    );
    expect(defaultProvenance.environment.CODEX_HOME).toBe(
      defaultProvenance.account_home,
    );

    const projectLaunch = await runtimeControl(request, "launch/resolve", {
      agent: "codex",
      project_account_id: "work",
    });
    expect((await data(projectLaunch)).account_id).toBe("work");

    const requestLaunch = await runtimeControl(request, "launch/resolve", {
      agent: "codex",
      project_account_id: "work",
      request_account_id: "personal",
    });
    expect((await data(requestLaunch)).account_id).toBe("personal");

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

    const heldLaunch = await runtimeControl(request, "launch/acquire", {
      agent: "codex",
    });
    expect((await data(heldLaunch)).account_id).toBe("personal");
    await fixtureControl(request, { version: "1.1.0", mode: "ok" });
    const deferredUpdate = await request.post(
      "/api/tracker/v1/settings/agents/codex/update",
      { headers: headers() },
    );
    expect((await data(deferredUpdate)).status).toBe("deferred");

    tools = await agentTools(request);
    let codex = tools.find((entry) => entry.id === "codex")!;
    expect(codex.status.version).toContain("1.0.0");
    expect(codex.install.pending_version).toContain("1.1.0");

    await setDefault(request, "work");
    const pinnedLaunch = await runtimeControl(request, "launch/status", {
      agent: "codex",
    });
    expect((await data(pinnedLaunch)).account_id).toBe("personal");
    const released = await runtimeControl(request, "launch/release", {
      agent: "codex",
    });
    expect(released.ok()).toBeTruthy();

    tools = await agentTools(request);
    codex = tools.find((entry) => entry.id === "codex")!;
    expect(codex.status.version).toContain("1.1.0");
    expect(codex.install.pending_version ?? null).toBeNull();
    await setDefault(request, "personal");

    await reportUsage(request, "personal", "personal-plan", 20);
    await reportUsage(request, "work", "team-plan", 40);
    let listedAccounts = await accounts(request);
    expect(
      listedAccounts.find((entry) => entry.id === "personal")!.usage!.plan,
    ).toBe("personal-plan");
    expect(
      listedAccounts.find((entry) => entry.id === "work")!.usage!.plan,
    ).toBe("team-plan");

    const generationOne = await beginUsage(request, "work", 100);
    const generationTwo = await beginUsage(request, "work", 200, true);
    expect(
      await completeUsage(request, {
        generation: generationOne,
        result: "success",
        now_ms: 300,
        now_seconds: 1_000,
        usage: {
          limit_name: "late-response",
          primary: { usedPercent: 90, resets_at: 2_000 },
        },
      }),
    ).toBe("ignored");
    expect(
      await completeUsage(request, {
        generation: generationTwo,
        result: "success",
        now_ms: 400,
        now_seconds: 1_000,
        usage: {
          limit_name: "current-response",
          primary: { usedPercent: 35, resets_at: 2_000 },
        },
      }),
    ).toBe("ok");
    listedAccounts = await accounts(request);
    expect(
      listedAccounts.find((entry) => entry.id === "work")!.usage!.plan,
    ).toBe("current-response");

    for (const [reason, expected] of [
      ["timeout", "timeout"],
      ["rate_limited", "rate_limited"],
      ["authentication", "authentication"],
      ["provider_failure", "provider_error"],
    ] as const) {
      await reportUsage(request, "work", "current-response", 35);
      const generation = await beginUsage(request, "work", 1_000, true);
      expect(
        await completeUsage(request, {
          generation,
          result: "error",
          reason,
          now_ms: 1_100,
          backoff_ms: 2_000,
        }),
      ).toBe("ok");
      listedAccounts = await accounts(request);
      const workUsage = listedAccounts.find(
        (entry) => entry.id === "work",
      )!.usage!;
      expect(workUsage.plan).toBe("current-response");
      expect(workUsage.stale).toBe(true);
      expect(workUsage.stale_reason).toBe(expected);
      expect(workUsage.next_refresh_at).toBe(3_100);
      expect(
        listedAccounts.find((entry) => entry.id === "personal")!.usage!.stale,
      ).toBe(false);
    }

    await reportUsage(request, "personal", "personal-plan", 100);
    await reportUsage(request, "work", "team-plan", 20);
    const disabledFailover = await runtimeControl(request, "launch/resolve", {
      agent: "codex",
    });
    expect((await data(disabledFailover)).account_id).toBe("personal");

    await page.reload();
    const failover = page.getByRole("checkbox", {
      name: "Automatic account failover",
    });
    await failover.check();
    await expect(failover).toBeChecked();
    const enabledFailover = await runtimeControl(request, "launch/resolve", {
      agent: "codex",
    });
    const failoverProvenance = await data(enabledFailover);
    expect(failoverProvenance.account_id).toBe("work");
    expect(failoverProvenance.failover.failed_over).toBe(true);

    await reportUsage(request, "work", "team-plan", 100);
    const allIneligible = await runtimeControl(request, "launch/resolve", {
      agent: "codex",
    });
    expect(allIneligible.status()).toBe(422);
    const ineligibleBody = await allIneligible.text();
    expect(ineligibleBody).toContain("all_accounts_ineligible");
    expect(ineligibleBody).not.toContain(dataRoot!);
    if (ineligibleBody.includes(SECRET_SENTINEL)) {
      throw new Error(
        "all-ineligible response exposed seeded credential material",
      );
    }

    await reportUsage(request, "personal", "personal-plan", 20);
    await reportUsage(request, "work", "team-plan", 20);
    const activePersonal = await runtimeControl(request, "launch/acquire", {
      agent: "codex",
    });
    expect((await data(activePersonal)).account_id).toBe("personal");
    await reportUsage(request, "personal", "personal-plan", 100);
    const activeStatus = await runtimeControl(request, "launch/status", {
      agent: "codex",
    });
    expect((await data(activeStatus)).account_id).toBe("personal");
    await runtimeControl(request, "launch/release", { agent: "codex" });
    const nextSession = await runtimeControl(request, "launch/resolve", {
      agent: "codex",
    });
    expect((await data(nextSession)).account_id).toBe("work");

    await reportUsage(request, "personal", "personal-plan", 20);
    await reportUsage(request, "work", "team-plan", 100);
    const resetEligibility = await runtimeControl(request, "launch/resolve", {
      agent: "codex",
    });
    expect((await data(resetEligibility)).account_id).toBe("personal");

    const autoUpdate = page.getByRole("checkbox", {
      name: "Automatic CLI updates",
    });
    await autoUpdate.uncheck();
    const disabledUpdateSettings = await request.get(
      "/api/tracker/v1/settings",
      {
        headers: headers(),
      },
    );
    expect(
      (await data(disabledUpdateSettings)).agent_cli.codex.auto_update,
    ).toBe(false);
    await autoUpdate.check();

    const source = page.getByRole("combobox", { name: "CLI source" });
    await source.selectOption("path");
    await expect(page.getByText(/^System PATH \(/)).toBeVisible();
    const explicitPath = await runtimeControl(request, "launch/resolve", {
      agent: "codex",
    });
    expect((await data(explicitPath)).effective_source).toBe("path");
    await source.selectOption("managed");

    tools = await agentTools(request);
    codex = tools.find((entry) => entry.id === "codex")!;
    const versionRoot = path.dirname(codex.status.path);
    await rm(versionRoot, { recursive: true, force: true });
    await page.reload();
    await expect(
      page.getByText("Managed preferred; using System PATH"),
    ).toBeVisible();
    const fallbackLaunch = await runtimeControl(request, "launch/resolve", {
      agent: "codex",
    });
    expect((await data(fallbackLaunch)).effective_source).toBe("path");

    const pathCodex = path.join(pathBin!, "codex");
    const pathFixture = await readFile(pathCodex);
    await rm(pathCodex);
    const noCandidate = await runtimeControl(request, "launch/resolve", {
      agent: "codex",
    });
    expect(noCandidate.status()).toBe(422);
    await writeFile(pathCodex, pathFixture);
    await chmod(pathCodex, 0o755);

    await page.getByRole("button", { name: "Repair" }).click();
    await expect(page.getByText(/^Managed isolated \(/)).toBeVisible();

    for (const mode of [
      "download_failure",
      "checksum_mismatch",
      "extraction_failure",
      "probe_failure",
    ]) {
      await fixtureControl(request, { version: "2.0.0", mode });
      const failedUpdate = await request.post(
        "/api/tracker/v1/settings/agents/codex/update",
        { headers: headers() },
      );
      expect(failedUpdate.status(), `${mode} must roll back`).toBe(422);
      tools = await agentTools(request);
      expect(
        tools.find((entry) => entry.id === "codex")!.status.version,
      ).toContain("1.1.0");
    }

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

    const accountResponse = await request.get(
      "/api/tracker/v1/settings/agents/codex/accounts",
      { headers: headers() },
    );
    if ((await accountResponse.text()).includes(SECRET_SENTINEL)) {
      throw new Error("account response exposed seeded credential material");
    }
    if (!(await readFile(credentialPath, "utf8")).includes(SECRET_SENTINEL)) {
      throw new Error(
        "managed update did not preserve isolated credential material",
      );
    }

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
    await page.getByTestId("agent-tool-settings").screenshot({
      path: testInfo.outputPath("agent-cli-lifecycle-mobile.png"),
    });
  });
});
