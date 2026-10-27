import { expect, test } from "@playwright/test";
import { HERO } from "./helpers";

test.describe("Auto-eventing", () => {
  test("reads passes from the rendered broadcast feed and grades them against the events", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(`/match/${HERO}/video`);
    await page.getByRole("combobox", { name: "Start at" }).selectOption("60");
    // The feed runs in real time: within half a minute the detector has seen several passes.
    const detected = page.locator(".stat").filter({ hasText: "Passes and shots" }).locator(".big");
    await expect.poll(async () => Number(await detected.innerText()), { timeout: 45_000 }).toBeGreaterThanOrEqual(3);
    await expect(page.locator(".autoevent-list li").filter({ hasText: "✓" }).first()).toBeVisible();
    const recall = await page.locator(".stat").filter({ hasText: "Found (recall)" }).locator(".big").innerText();
    expect(parseInt(recall, 10)).toBeGreaterThanOrEqual(50);
  });
});
