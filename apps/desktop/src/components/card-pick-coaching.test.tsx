import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CardPickCoaching } from "./card-pick-coaching";

const fullCoaching = {
  reasoning: {
    deckState: "14-card healthy deck with no committed archetype yet.",
    commitment: "Inflame is a Strength keystone and 3 support cards are in deck.",
  },
  headline: "Take Inflame — commits to Strength.",
  confidence: 0.82,
  keyTradeoffs: [
    { position: 1, upside: "Standalone damage.", downside: "Doesn't scale." },
    { position: 2, upside: "Unlocks scaling.", downside: "Commits the deck." },
  ],
  teachingCallouts: [
    {
      pattern: "keystone_available",
      explanation: "Deck has 3 Strength support cards; Inflame locks in.",
    },
  ],
};

describe("CardPickCoaching", () => {
  it("renders null when coaching is absent", () => {
    const { container } = render(<CardPickCoaching coaching={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders headline, deck_state, commitment, tradeoffs, callouts", () => {
    render(<CardPickCoaching coaching={fullCoaching} />);
    expect(screen.getByText(/Take Inflame/)).toBeInTheDocument();
    expect(screen.getByText(/14-card healthy deck/)).toBeInTheDocument();
    expect(screen.getByText(/Inflame is a Strength keystone/)).toBeInTheDocument();
    expect(screen.getByText(/Standalone damage/)).toBeInTheDocument();
    expect(screen.getByText(/Unlocks scaling/)).toBeInTheDocument();
    expect(screen.getByText(/keystone_available|Deck has 3 Strength support cards/)).toBeInTheDocument();
  });

  it("shows ConfidencePill from phase-1 reuse", () => {
    const { container } = render(<CardPickCoaching coaching={fullCoaching} />);
    expect(container.textContent).toMatch(/0\.82/);
  });

  it("renders gracefully when tradeoffs and callouts are empty", () => {
    const minimal = { ...fullCoaching, keyTradeoffs: [], teachingCallouts: [] };
    render(<CardPickCoaching coaching={minimal} />);
    expect(screen.getByText(/Take Inflame/)).toBeInTheDocument();
  });
});
