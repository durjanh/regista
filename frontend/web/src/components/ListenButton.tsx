import { useEffect, useState } from "react";
import { usePrefs } from "../lib/prefs";
import { speak, stopSpeaking } from "../lib/speech";
import { cx } from "../lib/format";
import { IconListen, IconStop } from "./icons";

export function ListenButton({ text, language, persona, small }: { text: string; language: string; persona?: string; small?: boolean }) {
  const { t } = usePrefs();
  const [playing, setPlaying] = useState(false);
  const [synthesising, setSynthesising] = useState(false);   // waiting on Azure AI Speech, before any sound
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
    setSynthesising(true);
    const engine = await speak(text, language, persona, () => setSynthesising(false));
    setVia(engine === "azure" ? "Azure AI Speech" : engine === "browser" ? "Browser voice" : null);
    setSynthesising(false);
    setPlaying(false);
  };

  return (
    <button
      type="button"
      className={cx("btn", small ? "sm" : undefined, playing && "signal")}
      onClick={toggle}
      aria-pressed={playing}
      aria-busy={synthesising}
      title={via ? `Last played with ${via}` : "Read aloud"}
    >
      {playing ? <IconStop /> : <IconListen />}
      {playing ? t("feed.stop") : t("feed.listen")}
    </button>
  );
}
