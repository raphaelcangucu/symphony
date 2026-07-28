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

const providers = [
  {
    agent: "claude",
    executable: "claude",
    homeEnvironment: "CLAUDE_CONFIG_DIR",
    label: "Claude Code",
    deferredVersion: "1.1.0",
    finalVersion: "2.1.0",
  },
  {
    agent: "codex",
    executable: "codex",
    homeEnvironment: "CODEX_HOME",
    label: "Codex",
    deferredVersion: "1.2.0",
    finalVersion: "2.2.0",
  },
  {
    agent: "cursor",
    executable: "cursor-agent",
    homeEnvironment: "CURSOR_AGENT_HOME",
    label: "Cursor Agent",
    deferredVersion: "1.3.0",
    finalVersion: "2.3.0",
  },
  {
    agent: "opencode",
    executable: "opencode",
    homeEnvironment: "OPENCODE_CONFIG_DIR",
    label: "OpenCode",
    deferredVersion: "1.4.0",
    finalVersion: "2.4.0",
  },
] as const;

type Agent = (typeof providers)[number]["agent"];

interface AgentToolResponse {
  id: Agent;
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

async function accounts(request: APIRequestContext, agent: Agent) {
  const response = await request.get(
    `/api/tracker/v1/settings/agents/${agent}/accounts`,
    { headers: headers() },
  );
  expect(response.ok()).toBeTruthy();
  return (await data(response)).accounts as AccountResponse[];
}

async function setDefault(
  request: APIRequestContext,
  agent: Agent,
  accountId: string,
) {
  const response = await request.put(
    `/api/tracker/v1/settings/agents/${agent}/accounts/${accountId}/default`,
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
  agent: Agent,
  accountId: string,
  plan: string,
  usedPercent: number,
) {
  usageReportId += 1;
  const response = await request.post("/api/tracker/v1/observability/report", {
    headers: headers(),
    data: {
      runtime_id: `agent-e2e-${agent}-${accountId}-${usageReportId}`,
      agent_kind: agent,
      agent_account_id: accountId,
      label: `${agent} lifecycle e2e`,
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
  agent: Agent,
  accountId: string,
  nowMs: number,
  force = false,
) {
  const response = await runtimeControl(request, "usage/begin", {
    agent,
    account_id: accountId,
    now_ms: nowMs,
    force,
  });
  expect(response.ok()).toBeTruthy();
  return (await data(response)).generation as number;
}

async function completeUsage(
  request: APIRequestContext,
  agent: Agent,
  input: Record<string, unknown>,
) {
  const response = await runtimeControl(request, "usage/complete", {
    agent,
    account_id: "work",
    ...input,
  });
  expect(response.ok()).toBeTruthy();
  return (await data(response)).result as string;
}

test.describe("isolated agent lifecycle", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [TOKEN_KEY, TOKEN] as const,
    );
  });

  for (const provider of providers) {
    test(`${provider.agent} covers lifecycle, isolated accounts, usage, failover, and mobile layout`, async ({
      page,
      request,
    }, testInfo) => {
      const { agent } = provider;
      const dataRoot = process.env.SYMPHONY_AGENT_E2E_DATA_ROOT;
      const pathBin = process.env.SYMPHONY_AGENT_E2E_PATH_BIN;
      expect(dataRoot, "disposable agent data root").toBeTruthy();
      expect(pathBin, "disposable PATH fixture root").toBeTruthy();

      await fixtureControl(request, { version: "1.0.0", mode: "ok" });
      await page.goto(`/tracker/settings/agents/${agent}`);
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

      let tools = await agentTools(request);
      let tool = tools.find((entry) => entry.id === agent)!;
      expect(tool.source.value).toBe("managed");
      expect(tool.source.preferred).toBe("managed");
      expect(tool.status.version).toContain("1.0.0");
      expect(
        path.resolve(tool.status.path).startsWith(path.resolve(dataRoot!)),
      ).toBeTruthy();
      expect((await stat(tool.status.path)).mode & 0o111).not.toBe(0);

      for (const account of [
        { id: "personal", label: "Personal" },
        { id: "work", label: "Work" },
      ]) {
        const response = await request.post(
          `/api/tracker/v1/settings/agents/${agent}/accounts`,
          {
            headers: headers(),
            data: { ...account, authentication_status: "authenticated" },
          },
        );
        expect(response.status()).toBe(201);
      }
      await setDefault(request, agent, "personal");

      const defaultLaunch = await runtimeControl(request, "launch/resolve", {
        agent,
      });
      expect(defaultLaunch.ok()).toBeTruthy();
      const defaultProvenance = await data(defaultLaunch);
      expect(defaultProvenance.account_id).toBe("personal");
      expect(defaultProvenance.observed_account_home).toBe(
        defaultProvenance.account_home,
      );
      expect(defaultProvenance.environment[provider.homeEnvironment]).toBe(
        defaultProvenance.account_home,
      );

      const projectLaunch = await runtimeControl(request, "launch/resolve", {
        agent,
        project_account_id: "work",
      });
      expect((await data(projectLaunch)).account_id).toBe("work");

      const requestLaunch = await runtimeControl(request, "launch/resolve", {
        agent,
        project_account_id: "work",
        request_account_id: "personal",
      });
      expect((await data(requestLaunch)).account_id).toBe("personal");

      const credentialPath = path.join(
        dataRoot!,
        agent,
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
        agent,
      });
      expect((await data(heldLaunch)).account_id).toBe("personal");
      await fixtureControl(request, {
        version: provider.deferredVersion,
        mode: "ok",
      });
      const deferredUpdate = await request.post(
        `/api/tracker/v1/settings/agents/${agent}/update`,
        { headers: headers() },
      );
      expect((await data(deferredUpdate)).status).toBe("deferred");

      tools = await agentTools(request);
      tool = tools.find((entry) => entry.id === agent)!;
      expect(tool.status.version).toContain("1.0.0");
      expect(tool.install.pending_version).toContain(provider.deferredVersion);

      await setDefault(request, agent, "work");
      const pinnedLaunch = await runtimeControl(request, "launch/status", {
        agent,
      });
      expect((await data(pinnedLaunch)).account_id).toBe("personal");
      const released = await runtimeControl(request, "launch/release", {
        agent,
      });
      expect(released.ok()).toBeTruthy();

      tools = await agentTools(request);
      tool = tools.find((entry) => entry.id === agent)!;
      expect(tool.status.version).toContain(provider.deferredVersion);
      expect(tool.install.pending_version ?? null).toBeNull();
      await setDefault(request, agent, "personal");

      await reportUsage(request, agent, "personal", "personal-plan", 20);
      await reportUsage(request, agent, "work", "team-plan", 40);
      let listedAccounts = await accounts(request, agent);
      expect(
        listedAccounts.find((entry) => entry.id === "personal")!.usage!.plan,
      ).toBe("personal-plan");
      expect(
        listedAccounts.find((entry) => entry.id === "work")!.usage!.plan,
      ).toBe("team-plan");

      const generationOne = await beginUsage(request, agent, "work", 100);
      const generationTwo = await beginUsage(request, agent, "work", 200, true);
      expect(
        await completeUsage(request, agent, {
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
        await completeUsage(request, agent, {
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
      listedAccounts = await accounts(request, agent);
      expect(
        listedAccounts.find((entry) => entry.id === "work")!.usage!.plan,
      ).toBe("current-response");

      for (const [reason, expected] of [
        ["timeout", "timeout"],
        ["rate_limited", "rate_limited"],
        ["authentication", "authentication"],
        ["provider_failure", "provider_error"],
      ] as const) {
        await reportUsage(request, agent, "work", "current-response", 35);
        const generation = await beginUsage(
          request,
          agent,
          "work",
          1_000,
          true,
        );
        expect(
          await completeUsage(request, agent, {
            generation,
            result: "error",
            reason,
            now_ms: 1_100,
            backoff_ms: 2_000,
          }),
        ).toBe("ok");
        listedAccounts = await accounts(request, agent);
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

      await reportUsage(request, agent, "personal", "personal-plan", 100);
      await reportUsage(request, agent, "work", "team-plan", 20);
      const disabledFailover = await runtimeControl(request, "launch/resolve", {
        agent,
      });
      expect((await data(disabledFailover)).account_id).toBe("personal");

      await page.reload();
      const failover = page.getByRole("checkbox", {
        name: "Automatic account failover",
      });
      await failover.check();
      await expect(failover).toBeChecked();
      const enabledFailover = await runtimeControl(request, "launch/resolve", {
        agent,
      });
      const failoverProvenance = await data(enabledFailover);
      expect(failoverProvenance.account_id).toBe("work");
      expect(failoverProvenance.failover.failed_over).toBe(true);

      await reportUsage(request, agent, "work", "team-plan", 100);
      const allIneligible = await runtimeControl(request, "launch/resolve", {
        agent,
      });
      expect(allIneligible.status()).toBe(422);
      const ineligibleBody = await allIneligible.text();
      expect(ineligibleBody).toContain("all_accounts_ineligible");
      expect(ineligibleBody).not.toContain(dataRoot!);
      if (ineligibleBody.includes(SECRET_SENTINEL)) {
        throw new Error(
          `${agent} all-ineligible response exposed credential material`,
        );
      }

      await reportUsage(request, agent, "personal", "personal-plan", 20);
      await reportUsage(request, agent, "work", "team-plan", 20);
      const activePersonal = await runtimeControl(request, "launch/acquire", {
        agent,
      });
      expect((await data(activePersonal)).account_id).toBe("personal");
      await reportUsage(request, agent, "personal", "personal-plan", 100);
      const activeStatus = await runtimeControl(request, "launch/status", {
        agent,
      });
      expect((await data(activeStatus)).account_id).toBe("personal");
      await runtimeControl(request, "launch/release", { agent });
      const nextSession = await runtimeControl(request, "launch/resolve", {
        agent,
      });
      expect((await data(nextSession)).account_id).toBe("work");

      await reportUsage(request, agent, "personal", "personal-plan", 20);
      await reportUsage(request, agent, "work", "team-plan", 100);
      const resetEligibility = await runtimeControl(request, "launch/resolve", {
        agent,
      });
      expect((await data(resetEligibility)).account_id).toBe("personal");

      const autoUpdate = page.getByRole("checkbox", {
        name: "Automatic CLI updates",
      });
      await autoUpdate.uncheck();
      const disabledUpdateSettings = await request.get(
        "/api/tracker/v1/settings",
        { headers: headers() },
      );
      expect(
        (await data(disabledUpdateSettings)).agent_cli[agent].auto_update,
      ).toBe(false);
      await autoUpdate.check();

      const source = page.getByRole("combobox", { name: "CLI source" });
      await source.selectOption("path");
      await expect(page.getByText(/^System PATH \(/)).toBeVisible();
      const explicitPath = await runtimeControl(request, "launch/resolve", {
        agent,
      });
      expect((await data(explicitPath)).effective_source).toBe("path");
      await source.selectOption("managed");

      tools = await agentTools(request);
      tool = tools.find((entry) => entry.id === agent)!;
      const versionRoot = path.dirname(tool.status.path);
      await rm(versionRoot, { recursive: true, force: true });
      await page.reload();
      await expect(
        page.getByText("Managed preferred; using System PATH"),
      ).toBeVisible();
      const fallbackLaunch = await runtimeControl(request, "launch/resolve", {
        agent,
      });
      expect((await data(fallbackLaunch)).effective_source).toBe("path");

      const pathExecutable = path.join(pathBin!, provider.executable);
      const pathFixture = await readFile(pathExecutable);
      await rm(pathExecutable);
      const noCandidate = await runtimeControl(request, "launch/resolve", {
        agent,
      });
      expect(noCandidate.status()).toBe(422);
      await writeFile(pathExecutable, pathFixture);
      await chmod(pathExecutable, 0o755);

      await page.getByRole("button", { name: "Repair" }).click();
      await expect(page.getByText(/^Managed isolated \(/)).toBeVisible();

      for (const mode of [
        "download_failure",
        "checksum_mismatch",
        "extraction_failure",
        "probe_failure",
      ]) {
        await fixtureControl(request, {
          version: provider.finalVersion,
          mode,
        });
        const failedUpdate = await request.post(
          `/api/tracker/v1/settings/agents/${agent}/update`,
          { headers: headers() },
        );
        expect(failedUpdate.status(), `${agent} ${mode} must roll back`).toBe(
          422,
        );
        tools = await agentTools(request);
        expect(
          tools.find((entry) => entry.id === agent)!.status.version,
        ).toContain(provider.deferredVersion);
      }

      await fixtureControl(request, {
        version: provider.finalVersion,
        mode: "ok",
      });
      const update = await request.post(
        `/api/tracker/v1/settings/agents/${agent}/update`,
        { headers: headers() },
      );
      expect(update.ok()).toBeTruthy();
      tools = await agentTools(request);
      expect(
        tools.find((entry) => entry.id === agent)!.status.version,
      ).toContain(provider.finalVersion);

      const accountResponse = await request.get(
        `/api/tracker/v1/settings/agents/${agent}/accounts`,
        { headers: headers() },
      );
      if ((await accountResponse.text()).includes(SECRET_SENTINEL)) {
        throw new Error(
          `${agent} account response exposed credential material`,
        );
      }
      if (!(await readFile(credentialPath, "utf8")).includes(SECRET_SENTINEL)) {
        throw new Error(
          `${agent} managed update did not preserve credential material`,
        );
      }

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/tracker/settings/agents/${agent}`);
      await expect(
        page.getByRole("heading", { name: provider.label, exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`agent-lifecycle-${agent}-desktop.png`),
        fullPage: true,
      });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await page
        .getByTestId("settings-scroll-container")
        .evaluate((element) => element.scrollTo({ top: 0 }));
      await expect(
        page.getByRole("combobox", { name: "Settings sections" }),
      ).toBeVisible();
      await expect(
        page.getByRole("navigation", { name: "Settings sections" }),
      ).not.toBeVisible();
      const mobileMetrics = await page.evaluate(() => ({
        viewportWidth: document.documentElement.clientWidth,
        contentWidth: document.documentElement.scrollWidth,
      }));
      expect(mobileMetrics.contentWidth).toBeLessThanOrEqual(
        mobileMetrics.viewportWidth,
      );

      const headerBox = await page
        .getByTestId("agent-tool-header")
        .boundingBox();
      const updateBox = await page
        .getByRole("button", { name: "Update CLI" })
        .boundingBox();
      expect(headerBox).not.toBeNull();
      expect(updateBox).not.toBeNull();
      expect(headerBox!.y).toBeLessThan(260);
      expect(updateBox!.width).toBeGreaterThan(headerBox!.width * 0.9);
      await page.screenshot({
        path: testInfo.outputPath(`agent-lifecycle-${agent}-mobile.png`),
        fullPage: true,
      });
      const accountsCard = page.getByTestId("agent-accounts-card");
      await accountsCard.scrollIntoViewIfNeeded();
      await expect(accountsCard).toBeVisible();
      await accountsCard.screenshot({
        path: testInfo.outputPath(
          `agent-lifecycle-${agent}-mobile-accounts.png`,
        ),
      });
    });
  }
});
