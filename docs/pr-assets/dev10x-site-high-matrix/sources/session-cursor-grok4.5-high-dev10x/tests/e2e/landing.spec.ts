import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures/symphony-evidence";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const evidenceScreens = path.join(
  workspaceRoot,
  ".symphony/evidence/artifacts/screens",
);

test.describe("Dev10x landing page", () => {
  test("landing benchmark · hero brand CTAs agents flow evidence nav mobile", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page).toHaveTitle(/Dev10x/i);

    const logo = page.getByRole("img", { name: "Dev10x", exact: true }).first();
    await expect(logo).toBeVisible();

    const heading = page.getByRole("heading", {
      name: "Engenharia verificável, do pedido à prova",
      exact: true,
    });
    await expect(heading).toBeVisible();

    const primaryCta = page
      .getByRole("link", {
        name: "Iniciar um projeto",
        exact: true,
      })
      .first();
    const secondaryCta = page.getByRole("link", {
      name: "Ver o fluxo",
      exact: true,
    });
    await expect(primaryCta).toBeVisible();
    await expect(secondaryCta).toBeVisible();

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/Symphony/i);

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
    await expect(fluxo.getByRole("heading", { level: 2 })).toContainText(/fluxo/i);

    const evidencias = page.locator("#evidencias");
    await expect(evidencias).toBeVisible();
    await expect(evidencias.getByRole("heading", { level: 2 })).toContainText(
      /evidência/i,
    );
    await expect(evidencias).toContainText(/testes/i);
    await expect(evidencias).toContainText(/screenshots/i);
    await expect(evidencias).toContainText(/vídeo|video/i);
    await expect(evidencias).toContainText(/trace/i);

    await page
      .getByRole("navigation", { name: "Principal" })
      .getByRole("link", { name: "Evidências", exact: true })
      .click();
    await expect(page).toHaveURL(/#evidencias$/);
    await expect(evidencias).toBeInViewport();

    await page.screenshot({
      path: path.join(
        evidenceScreens,
        "dev-2-landing-benchmark-hero-brand-ctas-agents-flow-evidence-nav-mobile-desktop-full.png",
      ),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    await page.screenshot({
      path: path.join(
        evidenceScreens,
        "dev-2-landing-benchmark-hero-brand-ctas-agents-flow-evidence-nav-mobile-mobile-full.png",
      ),
      fullPage: true,
    });
  });
});
