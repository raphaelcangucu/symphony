import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const SHOTS_DIR = resolve(process.cwd(), "test-results", "screenshots");

const FLOW_STAGES = [
  "Tarefa",
  "Agente",
  "Workspace isolado",
  "Preview",
  "Evidência",
  "Revisão",
] as const;

const AGENT_CARDS = ["Codex", "Cursor", "Claude"] as const;

const EVIDENCE_ARTIFACTS = ["Testes", "Screenshots", "Vídeo", "Trace"] as const;

async function captureFullPage(page: Page, name: string): Promise<string> {
  const path = resolve(SHOTS_DIR, name);
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  return path;
}

test.describe("Landing Dev10x — desktop", () => {
  test("apresenta a marca, o hero, os agentes, o fluxo e as evidências", async ({
    page,
  }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    const response = await page.goto("/", { waitUntil: "load" });
    expect(response?.ok(), "a aplicação deve responder por HTTP").toBeTruthy();
    expect(page.url()).toMatch(/^http:\/\//);

    // 1. Marca Dev10x, heading principal e as duas chamadas do hero.
    const brandLogo = page
      .getByRole("banner")
      .getByRole("img", { name: "Dev10x", exact: true });
    await expect(brandLogo).toBeVisible();
    await expect(brandLogo).toHaveAttribute("src", "/dev10x/dev10x_logo_color.png");

    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    await expect(heading).toContainText("Dev10x transforma intenção em");
    await expect(heading).toContainText("execução de engenharia verificável");

    const hero = page.locator("section.hero");
    const primaryCta = hero.getByRole("link", { name: "Iniciar um projeto", exact: true });
    const secondaryCta = hero.getByRole("link", {
      name: "Ver o fluxo de execução",
      exact: true,
    });
    await expect(primaryCta).toBeVisible();
    await expect(primaryCta).toHaveAttribute("href", "#comecar");
    await expect(secondaryCta).toBeVisible();
    await expect(secondaryCta).toHaveAttribute("href", "#fluxo");

    // 2. Nenhuma menção a Symphony no conteúdo visível.
    const visibleText = await page.locator("body").innerText();
    expect(visibleText.toLowerCase()).not.toContain("symphony");

    // 3. Cards distintos de Codex, Cursor e Claude.
    const agents = page.locator("#agentes");
    await expect(agents).toBeVisible();
    for (const name of AGENT_CARDS) {
      await expect(
        agents.getByRole("heading", { level: 3, name, exact: true }),
        `card do agente ${name}`,
      ).toBeVisible();
    }
    await expect(agents.locator(".agent-card")).toHaveCount(AGENT_CARDS.length);

    // 4. Seção do fluxo e seção de evidências.
    const flow = page.locator("#fluxo");
    await expect(
      flow.getByRole("heading", { level: 2, name: "Fluxo de execução", exact: true }),
    ).toBeVisible();
    await expect(flow.locator(".flow__stage")).toHaveCount(FLOW_STAGES.length);
    for (const stage of FLOW_STAGES) {
      await expect(
        flow.getByRole("heading", { level: 3, name: stage, exact: true }),
        `etapa ${stage} do fluxo`,
      ).toBeVisible();
    }

    const evidence = page.locator("#evidencias");
    await expect(
      evidence.getByRole("heading", {
        level: 2,
        name: "Evidências anexadas a cada run",
        exact: true,
      }),
    ).toBeVisible();
    for (const artifact of EVIDENCE_ARTIFACTS) {
      await expect(
        evidence.getByRole("heading", { level: 3, name: artifact, exact: true }),
        `artefato ${artifact}`,
      ).toBeVisible();
    }

    // Sessões interativas e execução pelo orquestrador.
    const sessions = page.locator("#sessoes");
    await expect(
      sessions.getByRole("heading", { level: 3, name: "Sessões interativas", exact: true }),
    ).toBeVisible();
    await expect(
      sessions.getByRole("heading", {
        level: 3,
        name: "Execução pelo orquestrador",
        exact: true,
      }),
    ).toBeVisible();

    // Rodapé com a marca Dev10x.
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("img", { name: "Dev10x", exact: true })).toBeVisible();
    await expect(footer).toContainText("Dev10x");

    // 5. Navegação por âncora.
    const nav = page.getByRole("navigation", { name: "Seções da página" });
    await nav.getByRole("link", { name: "Fluxo", exact: true }).click();
    await expect
      .poll(() => new URL(page.url()).hash, { timeout: 5_000 })
      .toBe("#fluxo");
    await expect
      .poll(
        async () => {
          const box = await flow.boundingBox();
          return box ? Math.round(box.y) : Number.NaN;
        },
        { timeout: 5_000, message: "a seção #fluxo deve encostar no topo da viewport" },
      )
      .toBeLessThanOrEqual(180);

    // Prova visual desktop.
    await page.evaluate(() => window.scrollTo(0, 0));
    const shot = await captureFullPage(page, "desktop-full.png");
    await testInfo.attach("desktop-full", { path: shot, contentType: "image/png" });

    expect(consoleErrors, "o console da página deve estar limpo").toEqual([]);
  });
});

test.describe("Landing Dev10x — mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("não tem overflow horizontal em viewport mobile", async ({ page }, testInfo) => {
    await page.goto("/", { waitUntil: "load" });

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      const offenders: string[] = [];
      for (const element of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.right > doc.clientWidth + 1) {
          offenders.push(`${element.tagName.toLowerCase()}.${element.className}`);
        }
      }
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        offenders: offenders.slice(0, 8),
      };
    });

    expect(overflow.offenders, "nenhum elemento deve estourar a viewport").toEqual([]);
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    const shot = await captureFullPage(page, "mobile-full.png");
    await testInfo.attach("mobile-full", { path: shot, contentType: "image/png" });
  });
});
