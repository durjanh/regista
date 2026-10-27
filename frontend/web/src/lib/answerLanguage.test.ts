import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { languageService } from "../api";
import { useAnswerIn } from "./answerLanguage";

afterEach(() => vi.restoreAllMocks());

describe("useAnswerIn", () => {
  it("shows an answer as written when the language hasn't changed", () => {
    const spy = vi.spyOn(languageService, "translate");
    const { result } = renderHook(() => useAnswerIn("Messi scored [f22].", "en", "en"));
    expect(result.current).toEqual({ text: "Messi scored [f22].", translating: false });
    expect(spy).not.toHaveBeenCalled();
  });

  it("translates an answer written in another language, keeping its citations", async () => {
    const spy = vi.spyOn(languageService, "translate").mockImplementation(async ([t]) =>
      ({ texts: [t.replace("Por números, el mejor fue Arrascaeta", "By the numbers, the best was Arrascaeta")], engine: "azure" }));
    const { result } = renderHook(() => useAnswerIn("Por números, el mejor fue Arrascaeta [f54][f55].", "es", "en"));
    expect(result.current.translating).toBe(true);
    await waitFor(() => expect(result.current.text).toBe("By the numbers, the best was Arrascaeta [f54][f55]."));
    expect(spy).toHaveBeenCalledWith(["Por números, el mejor fue Arrascaeta {0}{1}."], "en");
  });
});
