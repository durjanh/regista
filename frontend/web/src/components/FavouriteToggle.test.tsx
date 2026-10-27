import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FavouriteToggle } from "./FavouriteToggle";
import { HEALTH, mockApi, renderWithPrefs } from "../test/utils";

describe("FavouriteToggle", () => {
  it("shows an empty star until saved, then a filled one, and reports the click", () => {
    mockApi([HEALTH]);
    const onToggle = vi.fn();
    const { rerender } = renderWithPrefs(<FavouriteToggle name="Argentina" on={false} onToggle={onToggle} />);
    const button = screen.getByRole("button", { name: /Favourite/ });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveTextContent("☆");
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
    rerender(<FavouriteToggle name="Argentina" on onToggle={onToggle} />);
    expect(screen.getByRole("button", { name: /Favourite/ })).toHaveTextContent("★");
  });
});
