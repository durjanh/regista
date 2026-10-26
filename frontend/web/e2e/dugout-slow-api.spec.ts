import { expect, test } from "@playwright/test";
import { DUGOUT_MATCH, jumpAndPlay } from "./helpers";

// The Dugout must still render when each dashboard response takes longer than its poll interval (a slow CI agent or
// a busy API): polls wait for the previous call instead of discarding every response as stale.
test("Dugout renders with a slow API", async ({ page }) => {
  await page.route(/\/dugout\?/, async (route) => {
    await new Promise((r) => setTimeout(r, 4000));
    await route.continue();
  });
  await page.goto(`/match/${DUGOUT_MATCH}/dugout`);
  await jumpAndPlay(page, 70, 30);
  await expect(page.getByText(/Accept|No recommendations right now/).first()).toBeVisible({ timeout: 30_000 });
});
