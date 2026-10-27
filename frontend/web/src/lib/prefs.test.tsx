import { render, renderHook, screen, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { PrefsProvider, usePrefs } from "./prefs";
import { goalsFromEvents, currentChain, playerMaps, teamColors } from "./match";
import { CitedText, Markdown } from "../components/Markdown";
import { FactCheckBadge, FactCheckPanel, EngineBadge } from "../components/FactCheck";
import { event, match } from "../test/fixtures";
import { HEALTH, mockApi } from "../test/utils";

const wrapper = ({ children }: { children: ReactNode }) => <PrefsProvider>{children}</PrefsProvider>;

describe("PrefsProvider", () => {
  it("persists choices, links the Accessible persona to the accessible UI and sets document direction", async () => {
    mockApi([HEALTH]);
    const { result } = renderHook(() => usePrefs(), { wrapper });
    expect(result.current.persona).toBe("casual");
    await act(async () => result.current.setPersona("accessible"));
    expect(result.current.accessible).toBe(true);
    expect(document.documentElement.dataset.a11y).toBe("on");
    await act(async () => result.current.setAccessible(false));
    expect(result.current.persona).toBe("casual");
    await act(async () => result.current.setAccessible(true));
    expect(result.current.persona).toBe("accessible");
    await act(async () => result.current.setLanguage("ar"));
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.documentElement.lang).toBe("ar");
    expect(result.current.t("live.play")).not.toBe("Play");
    await act(async () => result.current.setTheme("light"));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(JSON.parse(localStorage.getItem("regista.language")!)).toBe("ar");
    expect(result.current.health?.mode).toBe("offline");
  });

  it("remembers favourite clubs and players, and toggles them off again", async () => {
    mockApi([HEALTH]);
    const { result } = renderHook(() => usePrefs(), { wrapper });
    expect(result.current.favClubs).toEqual([]);
    await act(async () => result.current.toggleFavClub("argentina"));
    await act(async () => result.current.toggleFavPlayer("argentina:lionel-messi"));
    expect(result.current.favClubs).toEqual(["argentina"]);
    expect(JSON.parse(localStorage.getItem("regista.favPlayers")!)).toEqual(["argentina:lionel-messi"]);
    await act(async () => result.current.toggleFavClub("argentina"));
    expect(result.current.favClubs).toEqual([]);
  });

  it("survives broken storage and a failing health check", async () => {
    mockApi([{ match: /health/, status: 500, reply: {} }]);
    const broken = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, clear: () => undefined };
    vi.stubGlobal("localStorage", broken);
    const { result } = renderHook(() => usePrefs(), { wrapper });
    await act(async () => result.current.setAutoplayAudio(true));
    expect(result.current.autoplayAudio).toBe(true);
    expect(result.current.health).toBeNull();
  });

  it("throws outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(() => usePrefs())).toThrow(/inside PrefsProvider/);
  });
});

describe("match helpers", () => {
  it("derives goals from score changes, player maps, colours and the current chain", () => {
    const evs = [
      event({ score: { home: 0, away: 0 }, possession_id: 1 }),
      event({ score: { home: 1, away: 0 }, minute: 55, player_name: "Gordon", possession_id: 2 }),
      event({ score: { home: 1, away: 1 }, minute: 90, added_minute: 3, player_name: "Martínez", possession_id: 3 }),
      event({ score: { home: 1, away: 1 }, possession_id: 3 }),
    ];
    expect(goalsFromEvents(evs).map((g) => [g.side, g.label, g.minute])).toEqual([["home", "55' Gordon", 55], ["away", "90' Martínez", 90.3]]);
    expect(currentChain(evs)).toHaveLength(2);
    expect(currentChain([])).toEqual([]);
    const m = { ...match, away: { ...match.away, players: [{ ...match.away.players[0], name: "Argentina No. 18", name_source: "placeholder" as const }] } };
    const maps = playerMaps(m);
    expect(maps.names.get("argentina-10")).toBe("Argentina No. 18 (no name in dataset)");
    expect(maps.placeholders.has("argentina-10")).toBe(true);
    expect(maps.shirts.get("england-09")).toBe(9);
    expect(teamColors(match)).toEqual({ home: "#ffffff", away: "#75aadb" });
  });
});

describe("Markdown and fact-check badges", () => {
  it("renders headings, lists, emphasis, code and citations as text, never HTML", () => {
    const onCite = vi.fn();
    render(<Markdown source={"## Report\nEngland **won** with *grit* [f1] and `xG` <b>x</b>\n\n- one\n- two\n1. first\n### Small"} citations={[{ fact_id: "f1", label: "Score", value: "2-1" }]} onCite={onCite} />);
    expect(screen.getByRole("heading", { level: 3, name: "Report" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 4, name: "Small" })).toBeInTheDocument();
    expect(screen.getByText("won").tagName).toBe("STRONG");
    expect(screen.getByText("grit").tagName).toBe("EM");
    expect(screen.getByText("xG").tagName).toBe("CODE");
    expect(screen.getByText(/<b>x<\/b>/)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    screen.getByRole("button", { name: /Source f1: Score: 2-1/ }).click();
    expect(onCite).toHaveBeenCalledWith(expect.objectContaining({ fact_id: "f1" }));
  });

  it("marks unknown citations as unverified", () => {
    render(<CitedText text="Claim [f9]" citations={[]} />);
    expect(screen.getByRole("button", { name: /Unverified reference/ })).toBeInTheDocument();
  });

  it("summarises fact-check results, failures included", () => {
    mockApi([HEALTH]);
    const fc = { passed: true, checked_claims: 4, issues: [], bias_flags: [] };
    const { rerender } = render(<FactCheckBadge fc={fc} />, { wrapper });
    expect(screen.getByTitle("4 claims verified against match data")).toBeInTheDocument();
    rerender(<FactCheckBadge fc={{ ...fc, bias_flags: [{ phrase: "natural athlete", suggestion: "describe the action" }] }} />);
    expect(screen.getByText(/1 wording flag$/)).toBeInTheDocument();
    rerender(<FactCheckBadge fc={{ ...fc, passed: false, issues: [{ sentence: "s", problem: "Number 9 is not in the fact sheet" }] }} />);
    expect(screen.getByText(/1 issue$/)).toBeInTheDocument();
    rerender(<FactCheckPanel fc={{ ...fc, passed: false, issues: [{ sentence: "Kane scored 9", problem: "Number 9 is not in the fact sheet" }], bias_flags: [{ phrase: "raw pace", suggestion: "say how" }] }} />);
    expect(screen.getByText(/Number 9 is not in the fact sheet/)).toBeInTheDocument();
    expect(screen.getByText(/raw pace/)).toBeInTheDocument();
    rerender(<EngineBadge engine="azure" ms={812.4} />);
    expect(screen.getByTitle("Generated by Azure OpenAI agents")).toHaveTextContent("812 ms");
  });
});
