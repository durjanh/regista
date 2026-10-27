import { useEffect, useRef } from "react";
import { languageService } from "../api";
import { quietly } from "./activity";
import { glossary } from "./glossary";

/**
 * Whole-page translation with Azure AI Translator (POST /api/translate).
 *
 * The strings in i18n.ts are Regista's own translations for five languages. Everything else on a page (labels written
 * in components, text that comes from the API, the seven languages without a dictionary) is English until this runs:
 * it translates the page's text nodes and title / aria-label / placeholder / alt attributes in place, batches new
 * strings, and caches every answer per language (in memory, and in localStorage when Azure answered).
 *
 * It only rewrites a text node's value, never the DOM structure, so React keeps its references. When React renders
 * new English into a node, the observer sees it and translates that. Switching back to English restores the
 * originals. Anything inside [translate="no"] (player names, the language menu, code), form fields, and strings
 * without words (scores, minutes, numbers, URLs) are left alone.
 */

const ATTRS = ["title", "aria-label", "placeholder", "alt"] as const;
const SKIP_ATTRS = '[translate="no"], .notranslate, script, style, code, pre, kbd';
const SKIP_TEXT = `${SKIP_ATTRS}, textarea`;                       // a field's placeholder is translated, its value never
const PERSIST_MAX = 200;     // labels are kept across visits; long live text (feed lines) only for this session
const BATCH = 100;           // strings per request (Translator allows 1,000 and 50,000 characters)
const MAX_CHARS = 2000;      // longer text is left as it is
const DEBOUNCE_MS = 120;
const SPLIT = / · | \/ |: /;              // short labels are translated part by part: "Shots / 90", "Goals: 1.53"
const SPLIT_MAX = 60;
const PROTECTED = /\bRegista\b/g;        // Translator reads the brand as Italian ("director"); it keeps {0} as is

const original = new WeakMap<Node, string>();                       // text node → its English source
const applied = new WeakMap<Node, string>();                        // text node → the value this module wrote
const attrState = new WeakMap<Element, Map<string, { original: string; applied: string }>>();
const memory = new Map<string, Map<string, string>>();              // language → English → translation

/** Text already written in the target language's script (an API answer in Hindi, say) needs no second pass. */
const SCRIPT: Record<string, RegExp> = {
  ar: /[\u0600-\u06FF]/, hi: /[\u0900-\u097F]/, ja: /[\u3040-\u30FF\u4E00-\u9FFF]/, "zh-Hans": /[\u4E00-\u9FFF]/,
};

function needsTranslation(text: string, language: string): boolean {
  const s = text.trim();
  if (SCRIPT[language]?.test(s)) return false;
  if (s.length < 2 || s.length > MAX_CHARS) return false;
  if (!/[A-Za-z]{2,}/.test(s)) return false;                         // numbers, scores, minutes, already-translated script
  if (/^(https?:\/\/|www\.)\S+$|^\S+\.(com|org|net|io)(\/\S*)?$/i.test(s)) return false;
  if (/^[A-Z]{2,3}$/.test(s) || /^[a-z]{2}(-[A-Za-z]+)?$/.test(s)) return false;   // ST, ENG, de, zh-Hans: codes
  // A person's name ("Declan Rice", "16' Trent Alexander-Arnold"): Translator would translate the words in it.
  if (/^(\d+'\+?\d*\s)?\p{Lu}[\p{L}'.-]+(\s(de|da|van|von|der|al|el|bin|the|of)?\s?\p{Lu}[\p{L}'.-]+){1,3}$/u.test(s)) return false;
  const letters = s.match(/[A-Za-z]/g)?.length ?? 0;
  return letters / s.replace(/\s/g, "").length >= 0.5;             // "Elo 2176 (#4)", "xG 1.23": data, not words
}

function cacheFor(language: string): Map<string, string> {
  let m = memory.get(language);
  if (!m) {
    m = new Map();
    try {
      const raw = localStorage.getItem(`regista.tx.${language}`);
      if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) m.set(k, v);
    } catch {
      /* storage unavailable: memory only */
    }
    memory.set(language, m);
  }
  return m;
}

function persist(language: string, fresh: Record<string, string>) {
  try {
    const key = `regista.tx.${language}`;
    const stored = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, string>;
    localStorage.setItem(key, JSON.stringify({ ...stored, ...fresh }));
  } catch {
    /* storage full or unavailable: the memory cache still holds them */
  }
}

/** Keep the node's leading and trailing whitespace around the translated core. */
function wrap(source: string, translated: string): string {
  const lead = source.match(/^\s*/)?.[0] ?? "";
  const trail = source.match(/\s*$/)?.[0] ?? "";
  return lead + translated + trail;
}

export function startPageTranslation(language: string, root: HTMLElement = document.body): () => void {
  const cache = cacheFor(language);
  const pending = new Set<string>();
  let timer: number | undefined;
  let stopped = false;

  /**
   * The translation of `text`, or undefined while part of it is still on its way. A label joined with " · " is
   * translated part by part (Translator turns "France · Elo 2176 (#4)" into another country), and football terms come
   * from the glossary, because a lone "Away" or "Formation" has no context to translate from.
   */
  const lookup = (text: string): string | undefined => {
    let missing = false;
    const one = (part: string) => {
      const key = part.trim();
      const term = glossary(language, key);
      if (term !== undefined) return wrap(part, term);
      if (!needsTranslation(part, language)) return part;
      const hit = cache.get(key);
      if (hit === undefined) {
        pending.add(key);
        missing = true;
        return part;
      }
      return wrap(part, hit);
    };
    if (text.trim().length > SPLIT_MAX || !SPLIT.test(text)) {
      const out = one(text);
      return missing ? undefined : out;
    }
    const pieces = text.split(new RegExp(`(${SPLIT.source})`));            // keep the separators
    const out = pieces.map((piece, i) => (i % 2 ? piece : one(piece))).join("");
    return missing ? undefined : out;
  };

  const translateText = (node: Text) => {
    if (node.parentElement?.closest(SKIP_TEXT)) return;
    const current = node.nodeValue ?? "";
    const source = applied.get(node) === current ? original.get(node) ?? current : current;
    original.set(node, source);
    const desired = language === "en" ? source : lookup(source);
    if (desired === undefined) return;
    if (desired !== current) {
      applied.set(node, desired);
      node.nodeValue = desired;
    }
  };

  const translateAttrs = (el: Element) => {
    if (el.closest(SKIP_ATTRS)) return;
    for (const name of ATTRS) {
      const current = el.getAttribute(name);
      if (current === null) continue;
      let states = attrState.get(el);
      const state = states?.get(name);
      const source = state && state.applied === current ? state.original : current;
      const desired = language === "en" ? source : lookup(source);
      if (desired === undefined) continue;
      if (!states) attrState.set(el, (states = new Map()));
      states.set(name, { original: source, applied: desired });
      if (desired !== current) el.setAttribute(name, desired);
    }
  };

  const scan = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      translateText(node as Text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    translateAttrs(node as Element);
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) translateText(n as Text);
      else translateAttrs(n as Element);
    }
    schedule();
  };

  const flush = async () => {
    timer = undefined;
    const texts = [...pending].filter((s) => !cache.has(s));
    pending.clear();
    for (let i = 0; i < texts.length; i += BATCH) {
      const chunk = texts.slice(i, i + BATCH);
      try {
        const res = await quietly(() => languageService.translate(chunk.map((c) => c.replace(PROTECTED, "{0}")), language));
        const fresh: Record<string, string> = {};
        chunk.forEach((s, j) => {
          const out = (res.texts[j] ?? s).replaceAll("{0}", "Regista");
          cache.set(s, out);
          if (res.engine === "azure" && s.length <= PERSIST_MAX) fresh[s] = out;
        });
        if (res.engine === "azure") persist(language, fresh);
      } catch {
        chunk.forEach((s) => cache.set(s, s));                     // API unreachable: leave English this session
      }
    }
    if (!stopped && texts.length) scan(root);
  };

  function schedule() {
    if (pending.size && timer === undefined && !stopped) timer = window.setTimeout(() => void flush(), DEBOUNCE_MS);
  }

  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") translateText(r.target as Text);
      else if (r.type === "attributes") translateAttrs(r.target as Element);
      else r.addedNodes.forEach(scan);
    }
    schedule();
  });

  scan(root);
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  return () => {
    stopped = true;
    observer.disconnect();
    if (timer !== undefined) window.clearTimeout(timer);
  };
}

/** Text left in another script after switching back to English: not the language menu, not text kept as is. */
export function leftoverForeignText(root: HTMLElement = document.body): string[] {
  const foreign = /[\u0600-\u06FF\u0900-\u097F\u3040-\u30FF\u4E00-\u9FFF]/;
  const out: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.nodeValue ?? "";
    if (foreign.test(text) && !n.parentElement?.closest(`${SKIP_TEXT}, select, option`)) out.push(text.trim());
  }
  return out;
}

const RELOAD_KEY = "regista.txReloadAt";

/**
 * Translate the whole page into `language`; English restores the originals. As a safety net, if any text is still in
 * another script a moment after switching back to English (a label both React and the translator wrote), the page
 * reloads once in English, which always renders clean: the language choice is saved. At most once a minute.
 */
export function usePageTranslation(language: string) {
  const previous = useRef(language);
  useEffect(() => {
    const from = previous.current;
    previous.current = language;
    const stop = startPageTranslation(language);
    if (language !== "en") return stop;
    stop();                                                         // the first scan restored English; nothing to watch
    if (from === "en") return undefined;
    const check = window.setTimeout(() => {
      if (!leftoverForeignText().length) return;
      try {
        const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
        if (Date.now() - last < 60_000) return;
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      } catch {
        return;                                                     // no storage: never risk a reload loop
      }
      window.location.reload();
    }, 800);
    return () => window.clearTimeout(check);
  }, [language]);
}
