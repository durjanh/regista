import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { speak, speakable, stopSpeaking } from "./speech";
import { ListenButton } from "../components/ListenButton";
import { HEALTH, mockApi, renderWithPrefs } from "../test/utils";

class FakeAudio {
  static last: FakeAudio;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  paused = false;
  constructor(public src: string) {
    FakeAudio.last = this;
  }
  play() {
    setTimeout(() => this.onended?.(), 0);
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

class FakeUtterance {
  lang = "";
  rate = 1;
  voice: unknown = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

const synth = { cancel: vi.fn(), getVoices: () => [{ lang: "es-ES", name: "Lucia" }], speak: vi.fn((u: FakeUtterance): void => {
  setTimeout(() => u.onend?.(), 0);
}) };

beforeEach(() => {
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  URL.createObjectURL = vi.fn(() => "blob:audio");
  URL.revokeObjectURL = vi.fn();
  synth.speak.mockClear();
});

describe("speech", () => {
  it("strips citations and markdown before speaking", () => {
    expect(speakable("**Goal** for `England` [f1]\n# now")).toBe("Goal for England now");
  });

  it("plays Azure AI Speech audio when the API returns it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["mp3"]), { status: 200 })));
    expect(await speak("Hello [f1]", "en", "casual")).toBe("azure");
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ text: "Hello", language: "en", persona: "casual" });
    stopSpeaking();
    expect(FakeAudio.last.paused).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:audio");
  });

  it("falls back to the browser voice in the right language when Speech is not configured or fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 501 })));
    expect(await speak("Hola", "es", "kids")).toBe("browser");
    const u = synth.speak.mock.calls[0][0] as FakeUtterance;
    expect(u.lang).toBe("es-ES");
    expect(u.voice).toEqual({ lang: "es-ES", name: "Lucia" });
    expect(u.rate).toBe(0.95);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await speak("Hello", "en")).toBe("browser");
  });

  it("says nothing for empty text", async () => {
    expect(await speak(" [f2] ", "en")).toBe("none");
  });

  it("ListenButton speaks, reports the engine and can stop", async () => {
    mockApi([HEALTH, { method: "POST", match: /\/speech$/, status: 501, reply: {} }]);
    renderWithPrefs(<ListenButton text="England lead" language="en" />);
    const btn = screen.getByRole("button");
    await userEvent.click(btn);
    await waitFor(() => expect(btn).toHaveAttribute("title", "Last played with Browser voice"));
    expect(btn).toHaveAttribute("aria-pressed", "false");
    synth.speak.mockImplementationOnce(() => undefined); // keeps "playing" until stopped
    await userEvent.click(btn);
    await waitFor(() => expect(btn).toHaveAttribute("aria-pressed", "true"));
    synth.cancel.mockClear();
    await act(async () => {
      await userEvent.click(btn);
    });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    expect(synth.cancel).toHaveBeenCalled();
  });
});
