import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { systemService } from "../api";
import type { Health, Persona } from "../api/types";
import { RTL, translate, type I18nKey } from "./i18n";

type Theme = "dark" | "light";

type Prefs = {
  persona: Persona;
  language: string;
  theme: Theme;
  accessible: boolean;
  autoplayAudio: boolean;
  setPersona: (p: Persona) => void;
  setLanguage: (l: string) => void;
  setTheme: (t: Theme) => void;
  setAccessible: (a: boolean) => void;
  setAutoplayAudio: (a: boolean) => void;
  t: (key: I18nKey) => string;
  health: Health | null;
};

const PrefsContext = createContext<Prefs | null>(null);

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`regista.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(`regista.${key}`, JSON.stringify(value));
  } catch {
    /* storage unavailable: preference lasts for this session only */
  }
}

function usePersisted<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => load(key, fallback));
  const set = useCallback(
    (v: T) => {
      setValue(v);
      save(key, v);
    },
    [key],
  );
  return [value, set];
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [persona, setPersonaRaw] = usePersisted<Persona>("persona", "casual");
  const [language, setLanguage] = usePersisted<string>("language", "en");
  const [theme, setTheme] = usePersisted<Theme>("theme", "dark");
  const [accessible, setAccessibleRaw] = usePersisted<boolean>("accessible", false);
  const [autoplayAudio, setAutoplayAudio] = usePersisted<boolean>("autoplayAudio", false);
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = () =>
      systemService
        .health()
        .then((h) => alive && setHealth(h))
        .catch(() => alive && setHealth(null));
    poll();
    const id = window.setInterval(poll, 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  // Choosing the Accessible persona switches the accessible UI on, and vice versa.
  const setPersona = useCallback(
    (p: Persona) => {
      setPersonaRaw(p);
      if (p === "accessible") setAccessibleRaw(true);
    },
    [setPersonaRaw, setAccessibleRaw],
  );
  const setAccessible = useCallback(
    (a: boolean) => {
      setAccessibleRaw(a);
      if (a) setPersonaRaw("accessible");
      else if (persona === "accessible") setPersonaRaw("casual");
    },
    [setAccessibleRaw, setPersonaRaw, persona],
  );

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.a11y = accessible ? "on" : "off";
    root.lang = language;
    root.dir = RTL.has(language) ? "rtl" : "ltr";
  }, [theme, accessible, language]);

  const value = useMemo<Prefs>(
    () => ({
      persona, language, theme, accessible, autoplayAudio,
      setPersona, setLanguage, setTheme, setAccessible, setAutoplayAudio,
      t: (key: I18nKey) => translate(language, key),
      health,
    }),
    [persona, language, theme, accessible, autoplayAudio, setPersona, setLanguage, setTheme, setAccessible, setAutoplayAudio, health],
  );

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): Prefs {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs must be used inside PrefsProvider");
  return ctx;
}
