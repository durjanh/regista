import { expect, test } from "@playwright/test";
import { HERO, broadcastApiAvailable, jumpAndPlay, scoreBugLabel, scoreBugMinute } from "./helpers";

test.describe("Hub", () => {
  test("shows the real-data strip and the featured fixtures, and opens a match", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("49,945").first()).toBeVisible();
    await expect(page.getByText("1872").first()).toBeVisible();
    await expect(page.getByText("Argentina").first()).toBeVisible();
    const openButtons = page.getByRole("link", { name: /Open match/ });
    expect(await openButtons.count()).toBeGreaterThanOrEqual(5);

    await page.locator(`a[href="/match/${HERO}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`/match/${HERO}`));
    await expect(page.getByText("Real result").first()).toBeVisible();
  });
});

test.describe("Loading feedback", () => {
  test("a slow backend call shows the loading indicator and a spinner, then the content", async ({ page }) => {
    // Hold /api/matches for 1.5 s, as a cold start would, then let it through.
    await page.route(/\/api\/matches$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.goto("/");
    await expect(page.locator(".activity-pill")).toHaveText(/Loading…/);
    await expect(page.locator(".activity-bar")).toBeVisible();
    await expect(page.locator(".spinner").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Open match/ }).first()).toBeVisible();
    await expect(page.locator(".activity-bar")).toHaveCount(0);
  });
});

test.describe("Matchday", () => {
  test("replays from 80:00 at speed: the clock advances", async ({ page }) => {
    await page.goto(`/match/${HERO}`);
    await jumpAndPlay(page, 80, 120);
    await expect.poll(() => scoreBugMinute(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(81);
    const label = await scoreBugLabel(page);
    expect(label).toMatch(/England \d+, Argentina \d+/);
  });

  test("the five views switch, and ?view= survives a reload", async ({ page }) => {
    await page.goto(`/match/${HERO}`);
    const views = page.getByRole("group", { name: "View" });
    for (const name of ["Casual", "Player focus", "Club focus", "Single metric", "Analyst"]) {
      await views.getByRole("button", { name: new RegExp(name) }).click();
      await expect(views.getByRole("button", { name: new RegExp(name) })).toHaveAttribute("aria-pressed", "true");
    }
    await views.getByRole("button", { name: /Single metric/ }).click();
    await expect(page).toHaveURL(/view=metric/);
    await page.reload();
    await expect(page.getByRole("group", { name: "View" }).getByRole("button", { name: /Single metric/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("offline (no Web PubSub): the live broadcast is unavailable and the replay keeps working", async ({ page }) => {
    test.skip(!(await broadcastApiAvailable(page)), "broadcast endpoints not in this API build yet");
    const start = await page.request.post(`/api/broadcast/${HERO}/start`, { data: { speed: 30, start_t: 0, languages: ["en"] } });
    expect(start.ok()).toBeTruthy();
    try {
      await page.goto(`/match/${HERO}`);
      await expect(page.getByText(/Live broadcast unavailable/).first()).toBeVisible();
      await page.getByRole("button", { name: /Replay/ }).first().click();
      await jumpAndPlay(page, 70, 120);
      await expect.poll(() => scoreBugMinute(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(71);
    } finally {
      await page.request.post(`/api/broadcast/${HERO}/stop`);
    }
  });
});
