import { languageService } from "../api";
import { speechLang } from "./i18n";

let current: HTMLAudioElement | null = null;
let currentUrl: string | null = null;

export function stopSpeaking() {
  if (current) {
    current.pause();
    current = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

/** Strip citation markers and markdown so speech reads cleanly. */
export function speakable(text: string): string {
  return text
    .replace(/\[f\d+\]/g, "")
    .replace(/[#*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Speak via Azure AI Speech (POST /api/speech). Falls back to the browser's speechSynthesis
 * when the API answers 501 (Speech not configured) or fails.
 * Resolves when playback ends; `onStart` fires when the audio actually starts, after synthesis.
 */
export async function speak(
  text: string, language: string, persona?: string, onStart?: () => void,
): Promise<"azure" | "browser" | "none"> {
  stopSpeaking();
  const clean = speakable(text);
  if (!clean) return "none";
  try {
    const blob = await languageService.synthesize(clean, language, persona);
    if (blob) {
      currentUrl = URL.createObjectURL(blob);
      const audio = new Audio(currentUrl);
      current = audio;
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.onplaying = () => onStart?.();
        audio.play().catch(() => resolve());
      });
      return "azure";
    }
  } catch {
    /* fall through to the browser voice */
  }
  if (!("speechSynthesis" in window)) return "none";
  const utter = new SpeechSynthesisUtterance(clean);
  utter.lang = speechLang(language);
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(utter.lang.toLowerCase().slice(0, 2)));
  if (voice) utter.voice = voice;
  utter.rate = persona === "kids" ? 0.95 : 1.02;
  await new Promise<void>((resolve) => {
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
    utter.onstart = () => onStart?.();
    window.speechSynthesis.speak(utter);
  });
  return "browser";
}
