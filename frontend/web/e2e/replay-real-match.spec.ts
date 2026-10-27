import { expect, test } from "@playwright/test";
import { scoreBugLabel } from "./helpers";

test.describe("Replay a real match", () => {
  test("finds a team's real result, rebuilds it and replays the real goals", async ({ page }) => {
    await page.goto("/?replay=argentina");
    const finder = page.locator("#replay");
    await finder.getByRole("combobox", { name: "Opponent" }).selectOption("england");
    await finder.getByRole("textbox", { name: "Year" }).fill("1986");
    const row = finder.getByRole("row").filter({ hasText: "1986-06-22" });
    await expect(row).toContainText("Argentina 2–1 England");
    await row.getByRole("button", { name: /Play/ }).click();

    await expect(page).toHaveURL(/\/match\/1986-06-22-argentina-england/);
    await expect(page.getByText("Real result").first()).toBeVisible();
    await page.getByRole("button", { name: /Skip to full time/ }).click();
    // Skip to full time streams the rest of the match quickly; the real 2–1 lands at 81'.
    await expect.poll(() => scoreBugLabel(page), { timeout: 45_000 }).toMatch(/^Argentina 2, England 1/);
  });
});
