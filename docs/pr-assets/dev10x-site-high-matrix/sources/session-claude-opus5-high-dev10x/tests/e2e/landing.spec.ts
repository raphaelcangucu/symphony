import { test, expect, type ConsoleMessage } from "@playwright/test";

const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.describe("landing page da Dev10x", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const response = await page.goto("/", { waitUntil: "load" });

    expect(response?.status()).toBe(200);
    // registra a navegação HTTP real para o manifesto de evidência
    testInfo.annotations.push({
      type: "navigation",
      description: `${response?.status()} ${response?.url()}`,
    });
  });

  test("apresenta a marca Dev10x, o heading principal e as duas chamadas do hero", async ({
    page,
  }) => {
    const nav = page.getByRole("banner");
    await expect(nav.getByRole("img", { name: "Dev10x" })).toBeVisible();

    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    await expect(heading).toContainText("Dev10x");

    const hero = page.getByRole("region", { name: "Dev10x", exact: true });
    await expect(
      hero.getByRole("link", { name: "Iniciar um projeto", exact: true }),
    ).toBeVisible();
    await expect(
      hero.getByRole("link", { name: "Ver o fluxo de execução", exact: true }),
    ).toBeVisible();
  });

  test("não expõe Symphony no conteúdo visível", async ({ page }) => {
    const visibleText = await page.locator("body").innerText();

    expect(visibleText).not.toMatch(/symphony/i);
    expect(visibleText).toMatch(/Dev10x/);
  });

  test("apresenta cards distintos para Codex, Cursor e Claude", async ({ page }) => {
    const agents = page.locator("#agentes");
    await expect(agents).toBeVisible();

    for (const name of ["Codex", "Cursor", "Claude"]) {
      await expect(agents.getByRole("heading", { name, exact: true })).toBeVisible();
    }

    await expect(agents.getByRole("listitem")).toHaveCount(3);
  });

  test("apresenta a seção do fluxo e a seção de evidências", async ({ page }) => {
    const flow = page.locator("#fluxo");
    await expect(flow).toBeVisible();
    for (const step of [
      "Tarefa",
      "Agente",
      "Workspace isolado",
      "Preview",
      "Evidência",
      "Revisão",
    ]) {
      await expect(flow.getByRole("heading", { name: step, exact: true })).toBeVisible();
    }

    const evidence = page.locator("#evidencias");
    await expect(evidence).toBeVisible();
    for (const artifact of ["Testes", "Screenshots", "Vídeo", "Trace"]) {
      await expect(
        evidence.getByRole("heading", { name: artifact, exact: true }),
      ).toBeVisible();
    }
  });

  test("navega por âncora ao clicar em um link da navegação", async ({ page }) => {
    const navigation = page.getByRole("navigation", { name: "Navegação principal" });

    await navigation.getByRole("link", { name: "Evidências", exact: true }).click();

    await expect(page).toHaveURL(/#evidencias$/);
    await expect(page.locator("#evidencias")).toBeInViewport();

    await navigation.getByRole("link", { name: "Fluxo", exact: true }).click();

    await expect(page).toHaveURL(/#fluxo$/);
    await expect(page.locator("#fluxo")).toBeInViewport();
  });

  test("não tem overflow horizontal em viewport mobile", async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto("/", { waitUntil: "load" });

    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      widest: Array.from(document.body.querySelectorAll("*")).reduce((max, element) => {
        const right = element.getBoundingClientRect().right;
        return right > max ? right : max;
      }, 0),
    }));

    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
    expect(metrics.widest).toBeLessThanOrEqual(metrics.innerWidth + 1);
  });

  test("não registra erros no console", async ({ page }) => {
    const problems: string[] = [];
    const collect = (message: ConsoleMessage) => {
      if (message.type() === "error" || message.type() === "warning") {
        problems.push(`${message.type()}: ${message.text()}`);
      }
    };

    page.on("console", collect);
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

    await page.goto("/", { waitUntil: "load" });
    await page.waitForTimeout(600);

    expect(problems).toEqual([]);
  });
});
