import { expect, test } from "@playwright/test";

const TOKEN_KEY = "symphony.tracker.token";
const PROJECT = process.env.SYMPHONY_E2E_PROJECT ?? "gamba";
const ISSUE = process.env.SYMPHONY_E2E_ISSUE ?? "GAM-23";

test.describe("issue sessions open", () => {
  test.beforeEach(async ({ page }) => {
    const token = process.env.SYMPHONY_TRACKER_TOKEN?.trim();
    test.skip(!token, "SYMPHONY_TRACKER_TOKEN is required");

    await page.addInitScript(
      ([key, value]) => {
        window.localStorage.setItem(key, value);
      },
      [TOKEN_KEY, token!] as const,
    );
  });

  test("clicking an execution session opens the workspaces thread", async ({ page }) => {
    await page.goto(`/tracker/projects/${PROJECT}/board/issues/${ISSUE}/sessions`);

    const openSession = page.getByRole("button", {
      name: new RegExp(`Open autonomous run ${ISSUE}`, "i"),
    });
    await expect(openSession).toBeVisible({ timeout: 45_000 });

    // Regression: the Sessions tab must not offer a same-page "Open issue" link.
    await expect(
      page.getByRole("link", { name: new RegExp(`Open issue ${ISSUE}`, "i") }),
    ).toHaveCount(0);

    await openSession.click();

    await expect(page).toHaveURL(
      new RegExp(`/tracker/projects/${PROJECT}/workspaces/\\d+$`),
      { timeout: 15_000 },
    );

    await expect(
      page.getByRole("tab", { name: new RegExp(`Run · ${ISSUE}`, "i") }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
