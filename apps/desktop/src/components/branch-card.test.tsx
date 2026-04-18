import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BranchCard } from "./branch-card";

describe("BranchCard", () => {
  const branch = {
    floor: 25,
    decision: "Elite or Monster?",
    recommended: "Elite",
    alternatives: [
      { option: "Monster", tradeoff: "Safer, lose relic." },
      { option: "Elite", tradeoff: "Take relic, next rest absorbs cost." },
    ],
    closeCall: false,
  };

  it("renders decision and recommended option", () => {
    render(<BranchCard branch={branch} />);
    expect(screen.getByText(/Floor 25/)).toBeInTheDocument();
    expect(screen.getByText(/Elite or Monster/)).toBeInTheDocument();
    expect(screen.getByText(/Recommend: Elite/)).toBeInTheDocument();
  });

  it("hides alternatives by default", () => {
    render(<BranchCard branch={branch} />);
    expect(screen.queryByText(/Safer, lose relic/)).not.toBeInTheDocument();
    expect(screen.queryByText(/next rest absorbs cost/)).not.toBeInTheDocument();
  });

  it("shows alternatives after the toggle is clicked", () => {
    render(<BranchCard branch={branch} />);
    const toggle = screen.getByRole("button", { expanded: false });
    fireEvent.click(toggle);
    expect(screen.getByText(/Safer, lose relic/)).toBeInTheDocument();
    expect(screen.getByText(/next rest absorbs cost/)).toBeInTheDocument();
  });

  it("applies close-call styling when closeCall is true", () => {
    const { container } = render(<BranchCard branch={{ ...branch, closeCall: true }} />);
    expect(container.firstChild).toHaveClass("border-amber-500/40");
    expect(container.firstChild).toHaveClass("border-dashed");
  });
});
