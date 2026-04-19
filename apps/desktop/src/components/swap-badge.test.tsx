import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SwapBadge } from "./swap-badge";

describe("SwapBadge", () => {
  it("renders SWAPPED label and reason as tooltip", () => {
    render(<SwapBadge reason="dominated_by_path_B" />);
    expect(screen.getByText(/swapped/i)).toBeInTheDocument();
    const el = screen.getByText(/swapped/i);
    expect(el.getAttribute("title")).toBe("dominated_by_path_B");
  });

  it("uses amber color tokens for visibility", () => {
    const { container } = render(<SwapBadge reason="x" />);
    expect(container.firstChild).toHaveClass("text-amber-400");
  });

  it("falls back to generic label when reason is null", () => {
    render(<SwapBadge reason={null} />);
    expect(screen.getByText(/swapped/i)).toBeInTheDocument();
  });
});
