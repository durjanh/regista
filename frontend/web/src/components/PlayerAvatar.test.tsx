import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlayerAvatar, initials } from "./PlayerAvatar";

describe("PlayerAvatar", () => {
  it("shows initials, or the shirt number for players the dataset doesn't name", () => {
    expect(initials("Lionel Messi")).toBe("LM");
    expect(initials("Enzo Fernández Junior")).toBe("EF");
    expect(initials("Argentina No. 18")).toBe("18");
  });

  it("is decorative, in the team's kit colours with readable text", () => {
    const { container } = render(<PlayerAvatar name="Harry Kane" colors={{ primary: "#FFFFFF", secondary: "#CE1124", text: "#0B1020" }} size={40} />);
    const el = container.querySelector(".player-avatar") as HTMLElement;
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toHaveTextContent("HK");
    expect(el.style.background).toBe("rgb(255, 255, 255)");
    expect(el.style.color).toBe("rgb(11, 16, 32)");   // dark text on a white shirt
    expect(el.style.width).toBe("40px");
  });
});
