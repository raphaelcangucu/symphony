import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const evidenceRoot = resolve(
  process.cwd(),
  "../.symphony/evidence/artifacts/screens",
);
const navigationsPath = resolve(
  process.cwd(),
  "test-results/symphony-navigations.json",
);

test("execução verificável da Dev10x da intenção à revisão", async ({
  page,
}, testInfo) => {
  const navigations: string[] = [];
  const consoleErrors: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame() && frame.url().startsWith("http")) {
      navigations.push(frame.url());
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/");

  await expect(
    page
      .getByRole("link", { name: "Dev10x — início", exact: true })
      .getByRole("img", { name: "Dev10x", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Da intenção à prova, engenharia em movimento.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Iniciar um projeto", exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Ver o fluxo", exact: true }),
  ).toBeVisible();

  await expect(page.locator("body")).not.toContainText("Symphony");

  for (const agent of ["Codex", "Cursor", "Claude"]) {
    await expect(
      page.getByRole("heading", { level: 3, name: agent, exact: true }),
    ).toBeVisible();
  }

  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Uma linha contínua da tarefa à revisão.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Prova que acompanha a mudança.",
      exact: true,
    }),
  ).toBeVisible();

  await page
    .getByRole("navigation", { name: "Navegação principal", exact: true })
    .getByRole("link", { name: "Evidências", exact: true })
    .click();
  await expect(page).toHaveURL(/#evidencias$/);
  await expect(page.locator("#evidencias")).toBeInViewport();

  await mkdir(evidenceRoot, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: resolve(
      evidenceRoot,
      "dev-4-execucao-verificavel-da-intencao-a-revisao-desktop-full.png",
    ),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBe(false);
  await page.screenshot({
    path: resolve(
      evidenceRoot,
      "dev-4-execucao-verificavel-da-intencao-a-revisao-mobile-full.png",
    ),
    fullPage: true,
  });
  expect(consoleErrors).toEqual([]);

  await mkdir(resolve(process.cwd(), "test-results"), { recursive: true });
  await writeFile(
    navigationsPath,
    JSON.stringify(
      {
        [testInfo.titlePath.join(" > ")]: [...new Set(navigations)],
      },
      null,
      2,
    ),
  );
});
