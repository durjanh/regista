import { expect, test } from "@playwright/test";
import { HERO, jumpAndPlay, presetFlags, scoreBugMinute } from "./helpers";

test.describe("Studio: the hero moment", () => {
  test("press switch detected, Verifier catches the planted number, truth panel scores it, counterfactual runs", async ({ page }) => {
    test.setTimeout(150_000);
    await presetFlags(page, { truthMode: true, verifierDrill: true });
    await page.goto(`/studio/${HERO}`);
    await expect(page.getByRole("checkbox", { name: /Truth mode/ })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /Verifier drill/ })).toBeChecked();

    await jumpAndPlay(page, 58, 120);

    // The press switch (planted 62:14) is detected around 67' and its line arrives with the Verifier strip.
    await expect(page.getByText(/Argentina pressing higher/).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Verifier drill: planted claim error").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Caught").first()).toBeVisible();
    await expect(page.getByText(/is not in the evidence/).first()).toBeVisible();

    // Truth panel: the planted press switch is graded as detected.
    const plant = page.locator("li").filter({ hasText: "Press switch" }).first();
    await expect(plant.getByText(/Detected/)).toBeVisible({ timeout: 30_000 });

    // Producer approves a proposed graphic: it leaves the Proposed tab and the Approved count goes up.
    const approvedTab = page.getByRole("tab", { name: /^Approved \d+/ });
    const approvedBefore = Number((await approvedTab.textContent())?.match(/\d+/)?.[0] ?? 0);
    const proposed = page.locator(".gfx").filter({ has: page.getByRole("button", { name: /Approve/ }) }).first();
    await expect(proposed).toBeVisible();
    await proposed.getByRole("button", { name: /Approve/ }).click();
    await expect(approvedTab).toHaveText(new RegExp(`Approved ${approvedBefore + 1}`));
    // The control room never shows graphics from later in the match (no full-time spoilers).
    const minutes = await page.locator(".gfx .gfx-kind").allTextContents();
    const now = await scoreBugMinute(page);
    expect(minutes.map((m) => Number(m.match(/(\d+)'/)?.[1] ?? 0)).every((m) => m <= now + 1)).toBeTruthy();

    // Counterfactual: replay the match without the change and show the measured effect.
    await plant.getByRole("button", { name: /What did it change\?/ }).click();
    await expect(plant.getByText("With change")).toBeVisible({ timeout: 90_000 });
    await expect(plant.getByText(/paired re-runs/).first()).toBeVisible();
    expect(await scoreBugMinute(page)).toBeGreaterThanOrEqual(67);
  });

  test("half-time pack: build it after 45' and queue a graphic for approval", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(`/studio/${HERO}`);
    await jumpAndPlay(page, 46, 120);
    const build = page.getByRole("button", { name: /Build half-time pack/ });
    await expect(build).toBeEnabled({ timeout: 30_000 });
    await build.click();
    // The pack (narrated talking points + suggested graphics) renders once the narrator returns.
    await expect(page.getByText("Suggested graphics", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".ht-points li").first()).toBeVisible();
    const add = page.getByRole("button", { name: /Add to queue/ }).first();
    if (await add.isVisible()) await add.click();   // a previous run against a reused server may have queued it already
    await expect(page.getByText(/Queued for approval|✓ Approved|✓ On air/).first()).toBeVisible();
  });
});

test.describe("Broadcast overlay", () => {
  test("receives a graphic the producer puts on air", async ({ context }) => {
    const overlay = await context.newPage();
    await overlay.goto(`/overlay/${HERO}`);
    await expect(overlay.locator("html")).toHaveClass(/overlay-mode/);
    // Transparent page for OBS / vMix.
    const bg = await overlay.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg === "rgba(0, 0, 0, 0)" || bg === "transparent").toBeTruthy();

    const studio = await context.newPage();
    await studio.goto(`/studio/${HERO}`);
    const card = studio.locator(".gfx").filter({ has: studio.getByRole("button", { name: /Put on air/ }) }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    const title = (await card.locator(".gfx-title").first().textContent())?.trim() ?? "";
    expect(title.length).toBeGreaterThan(0);
    await card.getByRole("button", { name: /Put on air/ }).click();

    await expect(overlay.getByText(title, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  });
});
