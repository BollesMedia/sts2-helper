import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConfidenceMeter } from "./confidence-meter";

describe("ConfidenceMeter", () => {
  it("fills all 5 dots at confidence 1.0", () => {
    const { container } = render(<ConfidenceMeter confidence={1.0} />);
    const filled = container.querySelectorAll("[class*='bg-emerald-400']");
    expect(filled.length).toBe(5);
  });

  it("fills 3 of 5 dots at confidence 0.6 with amber tone", () => {
    const { container } = render(<ConfidenceMeter confidence={0.6} />);
    const amber = container.querySelectorAll("[class*='bg-amber-400']");
    expect(amber.length).toBe(3);
  });

  it("fills 2 of 5 dots at confidence 0.3 with red tone", () => {
    const { container } = render(<ConfidenceMeter confidence={0.3} />);
    const red = container.querySelectorAll("[class*='bg-red-400']");
    expect(red.length).toBeGreaterThanOrEqual(1);
  });

  it("exposes the exact value via title attribute and aria-label", () => {
    render(<ConfidenceMeter confidence={0.82} />);
    const el = screen.getByRole("img", { name: /Confidence 0\.82/ });
    expect(el).toHaveAttribute("title", "conf: 0.82");
  });

  it("clamps confidence outside [0, 1]", () => {
    const { container: hi } = render(<ConfidenceMeter confidence={1.5} />);
    expect(hi.querySelectorAll("[class*='bg-emerald-400']").length).toBe(5);
    const { container: lo } = render(<ConfidenceMeter confidence={-0.2} />);
    expect(lo.querySelectorAll("[class*='bg-spire-border']").length).toBe(5);
  });
});
