import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const EVIDENCE_ROOT = path.resolve(process.cwd(), "..", ".symphony", "evidence");
const SCREEN_DIR = path.join(EVIDENCE_ROOT, "artifacts", "screens");

test.describe("Dev10x landing page", () => {
  test("marca, hero, fluxo, agentes, evidências e navegação", async ({
    page,
  }, testInfo) => {
    await mkdir(SCREEN_DIR, { recursive: true });

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await expect(page).toHaveTitle(/Dev10x/i);

    const brand = page.getByRole("img", { name: "Dev10x" }).first();
    await expect(brand).toBeVisible();

    const heading = page.getByRole("heading", {
      level: 1,
      name: "Da intenção à prova, com agentes sob o mesmo fio.",
      exact: true,
    });
    await expect(heading).toBeVisible();

    const primaryCta = page.getByRole("link", {
      name: "Iniciar um projeto",
      exact: true,
    });
    const secondaryCta = page.getByRole("link", {
      name: "Ver o fluxo",
      exact: true,
    });
    await expect(primaryCta).toBeVisible();
    await expect(secondaryCta).toBeVisible();

    const bodyText = await page.locator("body").innerText();
    expect(bodyText.toLowerCase()).not.toContain("symphony");

    await expect(
      page.getByRole("heading", { name: "Codex", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Cursor", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Claude", exact: true }),
    ).toBeVisible();

    const fluxo = page.locator("#fluxo");
    await expect(fluxo).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Linha de execução contínua",
        exact: true,
      }),
    ).toBeVisible();
    await expect(fluxo.getByText("Tarefa", { exact: true })).toBeVisible();
    await expect(fluxo.getByText("Revisão", { exact: true })).toBeVisible();

    const evidencias = page.locator("#evidencias");
    await expect(evidencias).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Prova anexada antes da revisão",
        exact: true,
      }),
    ).toBeVisible();
    await expect(evidencias.getByText("Testes", { exact: true })).toBeVisible();
    await expect(evidencias.getByText("Trace", { exact: true })).toBeVisible();

    await page.screenshot({
      path: path.join(SCREEN_DIR, "DEV-5-landing-desktop-full.png"),
      fullPage: true,
    });

    await page.getByRole("link", { name: "Evidências", exact: true }).click();
    await expect(page.locator("#evidencias")).toBeInViewport();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    await page.screenshot({
      path: path.join(SCREEN_DIR, "DEV-5-landing-mobile-full.png"),
      fullPage: true,
    });

    testInfo.annotations.push({
      type: "navigations",
      description: page.url(),
    });
  });
});
