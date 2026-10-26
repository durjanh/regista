import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureChart, InsightCard, VerifierStrip } from "./InsightCard";
import { drillCaught, insight, narrative } from "../test/fixtures";
import { HEALTH, mockApi, renderWithPrefs } from "../test/utils";

beforeEach(() => {
  mockApi([HEALTH]);
});

const svgTexts = (container: HTMLElement) => [...container.querySelectorAll("svg text")].map((t) => t.textContent);

describe("FeatureChart", () => {
  it("labels the detected change point and, in truth mode, the planted minute", () => {
    const { container } = renderWithPrefs(<FeatureChart feature={insight().feature} plantedMinute={63} />);
    const labels = svgTexts(container);
    expect(labels).toContain("detected 64'");
    expect(labels).toContain("planted 63'");
    expect(labels).toContain("0.27");
    expect(labels).toContain("0.82");
    expect(screen.getByRole("img")).toHaveAccessibleName(/0\.27 before minute 64, 0\.82 after/);
  });

  it("scales to the 90th percentile so a first-minute spike does not flatten the change", () => {
    const { container } = renderWithPrefs(<FeatureChart feature={insight().feature} />);
    // the series spikes to 3.00 in minute 1; the axis top stays near the real change instead
    expect(svgTexts(container)).not.toContain("3.00");
    expect(svgTexts(container)).not.toContain("planted 63'");
  });

  it("puts the detected label left of the line when the change is near the right edge", () => {
    const { container } = renderWithPrefs(<FeatureChart feature={insight().feature} />);
    const det = [...container.querySelectorAll("svg text")].find((t) => t.textContent?.startsWith("detected"));
    expect(det?.getAttribute("text-anchor")).toBe("end");
    const early = { ...insight().feature, change_minute: 10 };
    const { container: c2 } = renderWithPrefs(<FeatureChart feature={early} />);
    const det2 = [...c2.querySelectorAll("svg text")].find((t) => t.textContent?.startsWith("detected"));
    expect(det2?.getAttribute("text-anchor")).toBe("start");
  });

  it("says so when there is not enough data yet", () => {
    renderWithPrefs(<FeatureChart feature={{ ...insight().feature, series: [{ minute: 1, value: 0 }] }} />);
    expect(screen.getByText("Not enough data yet.")).toBeInTheDocument();
  });
});

describe("VerifierStrip", () => {
  it("shows a caught drill: the planted number struck through, the reason and the evidence", () => {
    renderWithPrefs(<VerifierStrip v={drillCaught} />);
    const strip = screen.getByRole("group", { name: /Verifier drill/ });
    expect(within(strip).getByText(/Caught/)).toBeInTheDocument();
    const flagged = within(strip).getByLabelText("flagged: 1.76");
    expect(flagged.tagName).toBe("DEL");
    expect(within(strip).getByText(/1\.76 is not in the evidence/)).toBeInTheDocument();
    expect(within(strip).getByText("0.82")).toBeInTheDocument();
    expect(within(strip).getByText(/Sent back to the Analyst/)).toBeInTheDocument();
    // citation markers are removed from the draft
    expect(strip.textContent).not.toContain("[f1]");
  });

  it("shows a missed drill: shows what was planted and that the clean draft aired", () => {
    renderWithPrefs(<VerifierStrip v={{ ...drillCaught, issues: [], caught: false }} />);
    const strip = screen.getByRole("group", { name: /Verifier drill/ });
    expect(within(strip).getByText(/Missed/)).toBeInTheDocument();
    expect(within(strip).queryByLabelText("flagged: 1.76")).toBeNull();
    expect(strip.textContent).toMatch(/0\.82.*→.*1\.76/);
    expect(within(strip).getByText(/clean draft/)).toBeInTheDocument();
  });

  it("shows a natural catch (no drill) under the plain Verifier label", () => {
    renderWithPrefs(
      <VerifierStrip v={{ drill: false, caught: null, planted: null, draft: "Pressing rose to 0.9 from 64'.",
        issues: [{ sentence: "x", problem: "Number 0.9 is not in the fact sheet" }, { sentence: "y", problem: "Citation [f9] does not exist" }] }} />,
    );
    const strip = screen.getByRole("group", { name: "Verifier" });
    expect(within(strip).getByText(/Caught/)).toBeInTheDocument();
    expect(within(strip).getByLabelText("flagged: 0.9")).toBeInTheDocument();
    expect(within(strip).getByText(/Citation \[f9\] does not exist/)).toBeInTheDocument();
  });
});

describe("InsightCard", () => {
  it("renders the structured sentence, confidence, receipt and no Verifier strip without a narrative", () => {
    renderWithPrefs(<InsightCard insight={insight()} teamName="ARG" teamColor="#75aadb" />);
    expect(screen.getByText("Argentina pressing higher from 64'")).toBeInTheDocument();
    expect(screen.getByText(/Press switch · ARG · since 64' · flagged at 67'/)).toBeInTheDocument();
    expect(screen.getByText("83%")).toBeInTheDocument();
    expect(screen.getByLabelText("KQL query")).toHaveTextContent("match_events");
    expect(screen.queryByRole("group", { name: /Verifier/ })).toBeNull();
  });

  it("renders the narrative with the Verifier strip and truth verdicts", () => {
    const ins = { ...insight(), narrative: narrative({ verification: drillCaught }) };
    renderWithPrefs(<InsightCard insight={ins} verdict="hit" plantedMinute={63} />);
    expect(screen.getByRole("group", { name: /Verifier drill/ })).toBeInTheDocument();
    expect(screen.getByTitle("Matches a planted change")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Source f1/ })).toBeInTheDocument();
  });

  it("marks false alarms and hides evidence chips in compact mode", () => {
    const { rerender } = renderWithPrefs(<InsightCard insight={insight()} verdict="false_alarm" compact />);
    expect(screen.getByTitle("Nothing was planted here")).toBeInTheDocument();
    expect(screen.queryByLabelText("Evidence")).toBeNull();
    rerender(<InsightCard insight={insight({ confidence: 0.4 })} />);
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("sends evidence clicks with the insight id, and disables chips without a handler", async () => {
    const onEvidence = vi.fn();
    const { rerender } = renderWithPrefs(<InsightCard insight={insight()} onEvidence={onEvidence} activeFact={`${insight().id}:in-1:after`} />);
    const chip = screen.getByRole("button", { name: /After 64'/ });
    expect(chip).toHaveClass("on");
    await userEvent.click(chip);
    expect(onEvidence).toHaveBeenCalledWith(expect.objectContaining({ fact_id: "in-1:after" }), insight().id);
    rerender(<InsightCard insight={insight()} />);
    expect(screen.getByRole("button", { name: /Before 64'/ })).toBeDisabled();
  });
});
