import { expect, type Page } from "@playwright/test";

export const HERO = "2026-07-15-england-argentina";
export const DUGOUT_MATCH = "2022-11-22-argentina-saudi-arabia";

/** Preset UI flags the app keeps in localStorage (truth mode, Verifier drill) before any page script runs. */
export async function presetFlags(page: Page, flags: Record<string, boolean>) {
  await page.addInitScript((f) => {
    for (const [k, v] of Object.entries(f)) localStorage.setItem(`regista.${k}`, v ? "1" : "0");
  }, flags);
}

/** Replay controls: jump to a match minute and pick a speed (both from the shared LiveControls toolbar). */
export async function jumpAndPlay(page: Page, minute: number, speed = 120) {
  const toolbar = page.getByRole("toolbar", { name: "Replay controls" });
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("combobox", { name: "Jump to" }).selectOption(String(minute));
  await toolbar.getByRole("button", { name: `${speed}×` }).click();
}

/** Current minute shown by the score bug ("England 0, Argentina 1, 63'" -> 63). */
export async function scoreBugMinute(page: Page): Promise<number> {
  const label = (await page.getByRole("group", { name: /, \d+'?/ }).first().getAttribute("aria-label")) ?? "";
  const m = label.match(/, (\d+)(?:\+\d+)?'/);
  return m ? Number(m[1]) : 0;
}

export async function scoreBugLabel(page: Page): Promise<string> {
  return (await page.locator(".scorebug").first().getAttribute("aria-label")) ?? "";
}

/** True when the API exposes the Web PubSub broadcast endpoints (added by the realtime work). */
export async function broadcastApiAvailable(page: Page): Promise<boolean> {
  const res = await page.request.get("/api/broadcast/status");
  return res.ok();
}
