import { expect, test } from "@playwright/test";
import { DUGOUT_MATCH, jumpAndPlay } from "./helpers";

test("Dugout: live manager advice at 70' for Argentina v Saudi Arabia", async ({ page }) => {
  await page.goto(`/match/${DUGOUT_MATCH}/dugout`);
  await jumpAndPlay(page, 70, 30);
  await expect(page.getByText("Recommendations").first()).toBeVisible();
  // Either concrete changes ("replace X with Y", chase/protect) or the explicit "on plan" state.
  await expect(page.getByText(/Accept|No recommendations right now/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Squad status").first()).toBeVisible();
});

test("Scouting: the player list opens a Player DNA page", async ({ page }) => {
  await page.goto("/scouting");
  await expect(page.getByRole("textbox", { name: "Search players" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("textbox", { name: "Search players" }).fill("Messi");
  await page.getByRole("link", { name: "Lionel Messi" }).first().click();
  await expect(page).toHaveURL(/\/scouting\/player\//);
  await expect(page.getByRole("heading", { name: /Lionel Messi/ })).toBeVisible();
  await expect(page.getByText("Real record").first()).toBeVisible();
});

test("Data Forge: the calibration report renders", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/forge");
  await expect(page.getByText("Calibration report").first()).toBeVisible();
  await expect(page.getByText(/Brier/).first()).toBeVisible({ timeout: 90_000 });
});

test("Ops: SLO and cost per match render", async ({ page }) => {
  await page.goto("/ops");
  await expect(page.getByText("Latency SLO").first()).toBeVisible();
  await expect(page.getByText("Cost per match").first()).toBeVisible();
});
