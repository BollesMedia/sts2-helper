import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CardPickCoaching } from "./card-pick-coaching";

const fullCoaching = {
  reasoning: {
    deckState: "14-card healthy deck with no committed archetype yet.",
    commitment: "Inflame is a Strength keystone and 3 support cards are in deck.",
  },
  headline: "Take Inflame. Commits the deck to Strength.",
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

  it("verdict banner splits headline and is always visible", () => {
    render(<CardPickCoaching coaching={fullCoaching} />);
    // Heading 3 (verdict) shows the first sentence, stripped and bold.
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "Take Inflame.",
    );
    // Reason (second sentence) renders under the verdict.
    expect(screen.getByText(/Commits the deck to Strength\./)).toBeInTheDocument();
  });

  it("confidence meter exposes the exact value in title", () => {
    render(<CardPickCoaching coaching={fullCoaching} />);
    const meter = screen.getByRole("img", { name: /Confidence 0\.82/ });
    expect(meter).toHaveAttribute("title", "conf: 0.82");
  });

  it("coach notes are collapsed by default when confidence >= 0.6", () => {
    render(<CardPickCoaching coaching={fullCoaching} />);
    expect(screen.queryByText(/14-card healthy deck/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Inflame is a Strength keystone/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Standalone damage/)).not.toBeInTheDocument();
  });

  it("shows coach notes after the toggle is clicked", () => {
    render(<CardPickCoaching coaching={fullCoaching} />);
    const toggle = screen.getByRole("button", {
      expanded: false,
      name: /Coach notes/i,
    });
    fireEvent.click(toggle);
    expect(screen.getByText(/14-card healthy deck/)).toBeInTheDocument();
    expect(screen.getByText(/Inflame is a Strength keystone/)).toBeInTheDocument();
    expect(screen.getByText(/Standalone damage/)).toBeInTheDocument();
    expect(screen.getByText(/Deck has 3 Strength support cards/)).toBeInTheDocument();
  });

  it("tradeoff downside is collapsed until its row is clicked", () => {
    render(<CardPickCoaching coaching={fullCoaching} />);
    fireEvent.click(
      screen.getByRole("button", { expanded: false, name: /Coach notes/i }),
    );
    // Upside (always visible) + downside (hidden until row click).
    expect(screen.queryByText(/Doesn't scale\./)).not.toBeInTheDocument();
    const cardRow = screen.getByRole("button", {
      expanded: false,
      name: /Standalone damage/,
    });
    fireEvent.click(cardRow);
    expect(screen.getByText(/Doesn't scale\./)).toBeInTheDocument();
  });

  it("auto-opens coach notes when confidence is below 0.6", () => {
    render(
      <CardPickCoaching coaching={{ ...fullCoaching, confidence: 0.5 }} />,
    );
    expect(screen.getByText(/14-card healthy deck/)).toBeInTheDocument();
    expect(screen.getByText(/Standalone damage/)).toBeInTheDocument();
  });

  it("renders without sections when tradeoffs and callouts are empty", () => {
    const minimal = { ...fullCoaching, keyTradeoffs: [], teachingCallouts: [] };
    render(<CardPickCoaching coaching={minimal} />);
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "Take Inflame.",
    );
    // notesCount is 0 — parenthetical count should not render.
    expect(screen.queryByText(/\(0\)/)).not.toBeInTheDocument();
  });

  it("does not render the emoji character from the prior design", () => {
    render(<CardPickCoaching coaching={fullCoaching} />);
    fireEvent.click(
      screen.getByRole("button", { expanded: false, name: /Coach notes/i }),
    );
    // Prior implementation used 💡 as the callout bullet. Redesign removes it
    // in favor of a middle-dot glyph consistent with the rest of the icon language.
    const calloutList = screen.getByText(/Deck has 3 Strength support cards/).closest("li");
    expect(calloutList?.textContent ?? "").not.toContain("💡");
  });
});
