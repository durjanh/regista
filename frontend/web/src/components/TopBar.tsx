import { NavLink } from "react-router-dom";
import type { Persona } from "../api/types";
import { LANGUAGES } from "../lib/i18n";
import { usePrefs } from "../lib/prefs";
import { IconDark, IconForge, IconLight, IconMatches, IconScouting } from "./icons";

const PERSONAS: Persona[] = ["casual", "analyst", "kids", "fantasy", "accessible"];

export function PersonaSelect({ compact }: { compact?: boolean }) {
  const { persona, setPersona, t } = usePrefs();
  return (
    <label className="row gap-6">
      <span className={compact ? "sr-only" : "xs muted"}>{t("persona")}</span>
      <select className="select" value={persona} onChange={(e) => setPersona(e.target.value as Persona)} aria-label={t("persona")}>
        {PERSONAS.map((p) => (
          <option key={p} value={p}>
            {t(`persona.${p}` as Parameters<typeof t>[0])}
          </option>
        ))}
      </select>
    </label>
  );
}

export function LanguageSelect({ compact }: { compact?: boolean }) {
  const { language, setLanguage, t } = usePrefs();
  return (
    <label className="row gap-6">
      <span className={compact ? "sr-only" : "xs muted"}>{t("language")}</span>
      <select className="select" value={language} onChange={(e) => setLanguage(e.target.value)} aria-label={t("language")} translate="no">
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TopBar() {
  const { t, theme, setTheme } = usePrefs();
  return (
    <header className="topbar">
      <NavLink to="/" className="brand" aria-label="Regista home">
        <span className="brand-mark" aria-hidden="true">
          R
        </span>
        <span className="brand-name" translate="no">Regista</span>
        <span className="brand-tag">{t("tagline")}</span>
      </NavLink>
      <nav className="topnav" aria-label="Primary">
        <NavLink to="/" end>
          <IconMatches /> {t("nav.hub")}
        </NavLink>
        <NavLink to="/scouting">
          <IconScouting /> {t("nav.scouting")}
        </NavLink>
        <NavLink to="/forge">
          <IconForge /> {t("nav.forge")}
        </NavLink>
      </nav>
      <div className="topbar-right">
        <span className="hide-sm">
          <PersonaSelect compact />
        </span>
        <LanguageSelect compact />
        <button className="btn icon ghost" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={t("theme.toggle")} title={t("theme.toggle")}>
          {theme === "dark" ? <IconLight /> : <IconDark />}
        </button>
      </div>
    </header>
  );
}
