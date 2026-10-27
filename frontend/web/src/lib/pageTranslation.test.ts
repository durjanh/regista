import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { languageService } from "../api";
import { startPageTranslation } from "./pageTranslation";

const fake = (texts: string[], to: string) => Promise.resolve({ texts: texts.map((s) => `[${to}] ${s}`), engine: "azure" });

describe("page translation", () => {
  let root: HTMLElement;
  beforeEach(() => {
    localStorage.clear();
    root = document.createElement("div");
    root.innerHTML = `<h1> Players </h1><span translate="no">Lionel Messi</span><b>8.1</b><b>ST</b>
      <input placeholder="Find a player"><textarea>my brief</textarea>`;
    document.body.appendChild(root);
  });
  afterEach(() => {
    root.remove();
    vi.restoreAllMocks();
  });

  it("translates text and attributes, and leaves names, numbers, codes and typed text alone", async () => {
    const spy = vi.spyOn(languageService, "translate").mockImplementation(fake);
    const stop = startPageTranslation("de", root);
    await waitFor(() => expect(root.querySelector("h1")?.textContent).toBe(" [de] Players "));
    expect(root.querySelector("input")?.getAttribute("placeholder")).toBe("[de] Find a player");
    expect(root.querySelector("span")?.textContent).toBe("Lionel Messi");
    expect(root.textContent).toContain("8.1");
    expect(root.textContent).toContain("ST");
    expect(root.querySelector("textarea")?.textContent).toBe("my brief");
    expect(spy).toHaveBeenCalledWith(["Players", "Find a player"], "de");
    stop();
  });

  it("translates text React writes later, and English restores the originals", async () => {
    vi.spyOn(languageService, "translate").mockImplementation(fake);
    const stop = startPageTranslation("es", root);
    const h1 = root.querySelector("h1")!;
    await waitFor(() => expect(h1.textContent).toBe(" [es] Players "));
    h1.firstChild!.nodeValue = "Teams";
    await waitFor(() => expect(h1.textContent).toBe("[es] Teams"));
    stop();
    startPageTranslation("en", root)();
    expect(h1.textContent).toBe("Teams");
    expect(root.querySelector("input")?.getAttribute("placeholder")).toBe("Find a player");
  });

  it("skips text already in the target script and keeps English when the API is unreachable", async () => {
    root.querySelector("h1")!.textContent = "खिलाड़ी Messi";
    const spy = vi.spyOn(languageService, "translate").mockRejectedValue(new Error("offline"));
    const stop = startPageTranslation("hi", root);
    await waitFor(() => expect(spy).toHaveBeenCalledWith(["Find a player"], "hi"));
    expect(root.querySelector("h1")?.textContent).toBe("खिलाड़ी Messi");
    expect(root.querySelector("input")?.getAttribute("placeholder")).toBe("Find a player");
    stop();
  });

  it("uses the football glossary, skips people's names, splits short labels and keeps the brand name", async () => {
    root.innerHTML = "<p>Shots</p><p>away</p><p>Declan Rice</p><p>Shots / 90</p><p>Ask Regista anything about the match</p>";
    const spy = vi.spyOn(languageService, "translate").mockImplementation((texts, to) =>
      Promise.resolve({ texts: texts.map((s) => `[${to}] ${s}`), engine: "azure" }));
    const stop = startPageTranslation("it", root);
    const p = [...root.querySelectorAll("p")];
    await waitFor(() => expect(p[4].textContent).toBe("[it] Ask Regista anything about the match"));
    expect(spy).toHaveBeenCalledWith(["Ask {0} anything about the match"], "it");
    expect(p.slice(0, 4).map((x) => x.textContent)).toEqual(["Tiri", "Trasferta", "Declan Rice", "Tiri / 90"]);
    stop();
  });
});
