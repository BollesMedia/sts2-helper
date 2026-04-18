import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ConfidencePill } from "./confidence-pill";

describe("ConfidencePill", () => {
  it("renders green when confidence >= 0.75", () => {
    const { container } = render(<ConfidencePill confidence={0.82} />);
    expect(container.firstChild).toHaveClass("text-emerald-400");
  });

  it("renders amber for 0.5-0.74", () => {
    const { container } = render(<ConfidencePill confidence={0.6} />);
    expect(container.firstChild).toHaveClass("text-amber-400");
  });

  it("renders red below 0.5", () => {
    const { container } = render(<ConfidencePill confidence={0.3} />);
    expect(container.firstChild).toHaveClass("text-red-400");
  });
});
