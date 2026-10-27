import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { HERO } from "./helpers";

const PAGES = [
  { name: "Hub", path: "/", ready: "49,945" },
  { name: "Matchday", path: `/match/${HERO}`, ready: "Real result" },
  { name: "Studio", path: `/studio/${HERO}`, ready: "Truth mode" },
  { name: "Scouting", path: "/scouting", ready: "Scouting" },
];

for (const p of PAGES) {
  test(`accessibility: no critical axe violations on ${p.name}`, async ({ page }, testInfo) => {
    await page.goto(p.path);
    await expect(page.getByText(p.ready).first()).toBeVisible({ timeout: 60_000 });
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    await testInfo.attach(`axe-${p.name}.json`, { body: JSON.stringify(results.violations, null, 2), contentType: "application/json" });
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(critical.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`)).toEqual([]);
  });
}

test("i18n: Spanish translates the chrome; Arabic switches to right-to-left", async ({ page }) => {
  await page.goto("/");
  const language = page.getByRole("combobox", { name: "Language" });
  await language.selectOption("es");
  await expect(page.getByRole("link", { name: /Abrir partido/ }).first()).toBeVisible();
  // The page translator also translates the menu's screen-reader label ("Primary" → "Principal").
  await expect(page.getByRole("navigation", { name: "Principal" }).getByText("Partidos")).toBeVisible();

  await page.getByRole("combobox", { name: "Idioma" }).selectOption("ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByRole("combobox", { name: "اللغة" }).selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});
