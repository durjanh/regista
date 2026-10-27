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

test.describe("Replay a match decided on penalties", () => {
  test("plays extra time with the real goals and ends with a shoot-out won by the real winner", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/?replay=argentina");
    const finder = page.locator("#replay");
    await finder.getByRole("combobox", { name: "Opponent" }).selectOption("france");
    await finder.getByRole("textbox", { name: "Year" }).fill("2022");
    const row = finder.getByRole("row").filter({ hasText: "2022-12-18" });
    await expect(row).toContainText("Argentina won on penalties");
    await row.getByRole("button", { name: /Play/ }).click();
    await expect(page).toHaveURL(/\/match\/2022-12-18-argentina-france/);
    await page.getByRole("button", { name: /Skip to full time/ }).click();
    await expect.poll(() => scoreBugLabel(page), { timeout: 60_000 }).toMatch(/^Argentina 3, France 3/);
    const panel = page.getByRole("region", { name: "Extra time and penalties" });
    await expect(panel.getByText("After extra time")).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText(/Argentina win \d–\d on penalties/)).toBeVisible();
    await expect(page.locator(".bc-ft")).toContainText("AFTER EXTRA TIME");                 // and on the full-time card
  });
});
