import { describe, expect, it } from "vitest";
import { beginActivity, getActivity, quietly, subscribeActivity } from "./activity";

describe("activity", () => {
  it("is busy while any call is in flight and idle once the last one finishes", () => {
    expect(getActivity().busy).toBe(false);
    const a = beginActivity();
    const since = getActivity().since;
    expect(getActivity().busy).toBe(true);
    const b = beginActivity();
    a();
    expect(getActivity()).toMatchObject({ busy: true, since });
    b();
    expect(getActivity().busy).toBe(false);
  });

  it("counts a finished call once, however often its done function runs", () => {
    const a = beginActivity();
    const b = beginActivity();
    a();
    a();
    expect(getActivity().busy).toBe(true);
    b();
    expect(getActivity().busy).toBe(false);
  });

  it("ignores calls started inside quietly (background refreshes)", () => {
    const done = quietly(() => beginActivity());
    expect(getActivity().busy).toBe(false);
    done();
    expect(getActivity().busy).toBe(false);
    expect(quietly(() => 42)).toBe(42);
  });

  it("notifies subscribers on every busy/idle change", () => {
    const seen: boolean[] = [];
    const off = subscribeActivity(() => seen.push(getActivity().busy));
    const done = beginActivity();
    done();
    off();
    beginActivity()();
    expect(seen).toEqual([true, false]);
  });
});
