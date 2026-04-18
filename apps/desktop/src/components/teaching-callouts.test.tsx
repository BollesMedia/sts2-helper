import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TeachingCallouts } from "./teaching-callouts";

describe("TeachingCallouts", () => {
  it("renders nothing when callouts array is empty", () => {
    const { container } = render(<TeachingCallouts callouts={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders each callout with explanation", () => {
    render(
      <TeachingCallouts
        callouts={[
          { pattern: "rest_after_elite", floors: [26], explanation: "Heals elite cost." },
          { pattern: "hard_pool", floors: [28, 29], explanation: "Expect 15+ HP per fight." },
        ]}
      />,
    );
    expect(screen.getByText(/Heals elite cost/)).toBeInTheDocument();
    expect(screen.getByText(/Expect 15\+ HP per fight/)).toBeInTheDocument();
  });
});
