import { usePrefs } from "../lib/prefs";

/** ☆ / ★ button that saves a club or player as a favourite (remembered in this browser). */
export function FavouriteToggle({ on, onToggle, name }: { on: boolean; onToggle: () => void; name: string }) {
  const { t } = usePrefs();
  return (
    <button type="button" className={on ? "btn sm fav on" : "btn sm ghost fav"} aria-pressed={on} onClick={onToggle}
      title={`${on ? "Remove" : "Save"} ${name} ${on ? "from" : "as"} a favourite`}>
      <span aria-hidden="true">{on ? "★" : "☆"}</span> {on ? t("fav.on") : t("fav.add")}
    </button>
  );
}
