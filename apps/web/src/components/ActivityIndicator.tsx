import { useEffect, useState } from "react";
import { useActivity } from "../lib/activity";
import { usePrefs } from "../lib/prefs";
import { Spinner } from "./States";

/** Shown only for calls slower than this, so quick ones don't flicker. */
const SHOW_AFTER_MS = 300;
/** The API scales to zero on Container Apps: a call still running after this is most likely the cold start. */
const WAKING_AFTER_MS = 5000;

/**
 * Global loading indicator for every backend call (ApiService and connecting live streams): a progress bar under the
 * top bar and a status pill, with an explanation when the API is waking up. Background refreshes don't trigger it.
 */
export function ActivityIndicator() {
  const { busy, since } = useActivity();
  const { t } = usePrefs();
  const [phase, setPhase] = useState<"hidden" | "loading" | "waking">("hidden");

  useEffect(() => {
    if (!busy) {
      setPhase("hidden");
      return;
    }
    const elapsed = Date.now() - since;
    const show = window.setTimeout(() => setPhase("loading"), Math.max(0, SHOW_AFTER_MS - elapsed));
    const waking = window.setTimeout(() => setPhase("waking"), Math.max(0, WAKING_AFTER_MS - elapsed));
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(waking);
    };
  }, [busy, since]);

  const message = phase === "waking" ? t("loading.waking") : phase === "loading" ? t("loading") : "";
  return (
    <>
      {phase !== "hidden" ? <div className="activity-bar" aria-hidden="true" /> : null}
      <div className={phase === "hidden" ? "sr-only" : "activity-pill"} role="status" aria-live="polite">
        {phase !== "hidden" ? <Spinner size="sm" /> : null}
        {message}
      </div>
    </>
  );
}
