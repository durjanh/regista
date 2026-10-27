import { useEffect, useState } from "react";
import { languageService } from "../api";
import { quietly } from "./activity";

/**
 * An AI answer written in one language, shown in another: when the viewer switches language after asking, the
 * answer is translated by Azure AI Translator (through the API), with its fact citations ([f22]) kept exactly.
 * The page translator can't do this on its own: to it, an answer written in Spanish *is* the original.
 */
const cache = new Map<string, string>();

export function useAnswerIn(text: string, writtenIn: string, showIn: string): { text: string; translating: boolean } {
  const key = `${showIn}\u0000${text}`;
  const [, bump] = useState(0);
  const same = writtenIn === showIn || !text;
  useEffect(() => {
    if (same || cache.has(key)) return;
    let live = true;
    // Citations become numbered placeholders, which Translator leaves alone, and go back afterwards.
    const cites: string[] = [];
    const masked = text.replace(/\[f\d+\]/g, (m) => `{${cites.push(m) - 1}}`);
    quietly(() => languageService.translate([masked], showIn))
      .then((r) => {
        const out = (r.texts[0] ?? masked).replace(/\{(\d+)\}/g, (_, i) => cites[Number(i)] ?? "");
        cache.set(key, r.engine === "azure" ? out : text);
      })
      .catch(() => cache.set(key, text))
      .finally(() => live && bump((n) => n + 1));
    return () => {
      live = false;
    };
  }, [key, same, showIn, text]);
  if (same) return { text, translating: false };
  const hit = cache.get(key);
  return { text: hit ?? text, translating: hit === undefined };
}
