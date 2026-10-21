import { useEffect, useState } from "react";
import { usePrefs } from "../lib/prefs";
import { speak, stopSpeaking } from "../lib/speech";
import { cx } from "../lib/format";

export function ListenButton({ text, language, persona, small }: { text: string; language: string; persona?: string; small?: boolean }) {
  const { t } = usePrefs();
  const [playing, setPlaying] = useState(false);
  const [via, setVia] = useState<string | null>(null);

  useEffect(() => () => {
    if (playing) stopSpeaking();
  }, [playing]);

  const toggle = async () => {
    if (playing) {
      stopSpeaking();
      setPlaying(false);
      return;
    }
    setPlaying(true);
    const engine = await speak(text, language, persona);
    setVia(engine === "azure" ? "Azure AI Speech" : engine === "browser" ? "Browser voice" : null);
    setPlaying(false);
  };

  return (
    <button
      type="button"
      className={cx("btn", small ? "sm" : undefined, playing && "signal")}
      onClick={toggle}
      aria-pressed={playing}
      title={via ? `Last played with ${via}` : "Read aloud"}
    >
      <span aria-hidden="true">{playing ? "■" : "🔊"}</span>
      {playing ? t("feed.stop") : t("feed.listen")}
    </button>
  );
}
