import { describe, expect, it } from "vitest";
import { LANGUAGES, RTL, speechLang, translate, type I18nKey } from "./i18n";

// The English dictionary is the source of truth; read its keys through translate() so the test tracks the real file.
const source = await import("./i18n?raw").then((m: { default: string }) => m.default);
const enBlock = source.slice(source.indexOf("const en = {"), source.indexOf("export type I18nKey"));
const KEYS = [...enBlock.matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1] as I18nKey);

describe("i18n", () => {
  it("has a non-empty English string for every key", () => {
    expect(KEYS.length).toBeGreaterThan(100);
    for (const k of KEYS) expect(translate("en", k), k).toMatch(/\S/);
  });

  it("translates the UI chrome into es, fr, ar and hi", () => {
    for (const lang of ["es", "fr", "ar", "hi"]) {
      const translated = KEYS.filter((k) => translate(lang, k) !== translate("en", k));
      // Partial dictionaries are allowed by design (Dict is Partial); most chrome is translated.
      expect(translated.length / KEYS.length, lang).toBeGreaterThan(0.8);
    }
    expect(translate("es", "live.play")).toBe("Reproducir");
  });

  it("falls back to English for languages without a dictionary", () => {
    for (const k of KEYS) expect(translate("ja", k)).toBe(translate("en", k));
    expect(translate("de", "live.pause")).toBe("Pause");
  });

  it("covers the new Verifier, half-time and view strings in every dictionary", () => {
    const block = (lang: string) => source.slice(source.indexOf(`const ${lang}: Dict = {`), source.indexOf("};", source.indexOf(`const ${lang}: Dict = {`)));
    const keys = ["verifier.drill", "verifier.caught", "verifier.missed", "ht.add", "ht.queued", "view.casual", "view.player"];
    for (const lang of ["es", "fr", "ar", "hi"]) for (const k of keys) expect(block(lang), `${lang}:${k}`).toContain(`"${k}":`);
    expect(translate("fr", "verifier.caught")).not.toBe(translate("en", "verifier.caught"));
  });

  it("keeps the template placeholder in every translation of notInEvidence", () => {
    for (const lang of ["en", "es", "fr", "ar", "hi"]) expect(translate(lang, "verifier.notInEvidence")).toContain("{n}");
  });

  it("lists twelve languages with speech locales, Arabic right-to-left", () => {
    expect(LANGUAGES).toHaveLength(12);
    expect(RTL.has("ar")).toBe(true);
    expect(speechLang("hi")).toBe("hi-IN");
    expect(speechLang("xx")).toBe("en-GB");
  });
});
