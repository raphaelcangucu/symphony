import { expect, test } from "@playwright/test";

test("landing Dev10x apresenta a execução verificável em desktop", async ({
  page,
}) => {
  const browserProblems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      browserProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => browserProblems.push(`pageerror: ${error.message}`));

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");

  const skipLinkBounds = await page.getByText("Ir para o conteúdo", { exact: true }).boundingBox();
  expect(skipLinkBounds?.y).toBeLessThanOrEqual(-2 * (skipLinkBounds?.height ?? 0));

  await expect(page.getByRole("img", { name: "Dev10x", exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Engenharia em movimento. Evidência em mãos.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Iniciar um projeto", exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Ver o fluxo", exact: true }),
  ).toBeVisible();

  await expect(page.locator("body")).not.toContainText(/Symphony/i);

  for (const agent of ["Codex", "Cursor", "Claude"]) {
    await expect(
      page.getByRole("heading", { level: 3, name: agent, exact: true }),
    ).toBeVisible();
  }

  await expect(page.locator("#fluxo")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Da tarefa à revisão, sem perder o fio.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("#evidencias")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Prova pronta para revisão.",
      exact: true,
    }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Fluxo", exact: true }).click();
  await expect(page).toHaveURL(/#fluxo$/);
  await expect(page.locator("#fluxo")).toBeInViewport();

  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await expect(page.locator("#visao")).toBeInViewport();
  expect(browserProblems).toEqual([]);

  await page.screenshot({
    path: "test-results/screens/dev-1-landing-dev10x-execucao-verificavel-desktop-full.png",
    fullPage: true,
  });
});

test("landing Dev10x permanece íntegra em viewport mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Engenharia em movimento. Evidência em mãos.",
      exact: true,
    }),
  ).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);

  await page.screenshot({
    path: "test-results/screens/dev-1-landing-dev10x-execucao-verificavel-mobile-full.png",
    fullPage: true,
  });
});
