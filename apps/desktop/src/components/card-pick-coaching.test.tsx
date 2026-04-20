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
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "Take Inflame.",
    );
    expect(screen.getByText(/Commits the deck to Strength\./)).toBeInTheDocument();
  });

  it("confidence meter exposes the exact value in title", () => {
    render(<CardPickCoaching coaching={fullCoaching} />);
    const meter = screen.getByRole("img", { name: /Confidence 0\.82/ });
    expect(meter).toHaveAttribute("title", "conf: 0.82");
  });

  it("shows deck state and commitment briefs by default (always visible)", () => {
    render(<CardPickCoaching coaching={fullCoaching} />);
    expect(screen.getByText(/14-card healthy deck/)).toBeInTheDocument();
    expect(screen.getByText(/Inflame is a Strength keystone/)).toBeInTheDocument();
  });

  it("collapses tradeoffs and patterns by default at high confidence", () => {
    render(<CardPickCoaching coaching={fullCoaching} />);
    expect(screen.queryByText(/Standalone damage\./)).not.toBeInTheDocument();
    expect(screen.queryByText(/Unlocks scaling\./)).not.toBeInTheDocument();
    expect(screen.queryByText(/Deck has 3 Strength support cards/)).not.toBeInTheDocument();
  });

  it("shows tradeoff upsides after the Tradeoffs section is opened", () => {
    render(<CardPickCoaching coaching={fullCoaching} />);
    fireEvent.click(
      screen.getByRole("button", { expanded: false, name: /Tradeoffs/i }),
    );
    expect(screen.getByText(/Standalone damage\./)).toBeInTheDocument();
    expect(screen.getByText(/Unlocks scaling\./)).toBeInTheDocument();
    // Downsides still hidden — they're nested behind per-row disclosure.
    expect(screen.queryByText(/Doesn't scale\./)).not.toBeInTheDocument();
  });

  it("reveals a tradeoff downside only after its row is clicked", () => {
    render(<CardPickCoaching coaching={fullCoaching} />);
    fireEvent.click(
      screen.getByRole("button", { expanded: false, name: /Tradeoffs/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { expanded: false, name: /Standalone damage/ }),
    );
    expect(screen.getByText(/Doesn't scale\./)).toBeInTheDocument();
  });

  it("shows teaching callouts after the Patterns section is opened", () => {
    render(<CardPickCoaching coaching={fullCoaching} />);
    fireEvent.click(
      screen.getByRole("button", {
        expanded: false,
        name: /Patterns to remember/i,
      }),
    );
    expect(
      screen.getByText(/Deck has 3 Strength support cards/),
    ).toBeInTheDocument();
  });

  it("auto-opens tradeoffs and patterns when confidence is below 0.6", () => {
    render(
      <CardPickCoaching coaching={{ ...fullCoaching, confidence: 0.5 }} />,
    );
    expect(screen.getByText(/Standalone damage\./)).toBeInTheDocument();
    expect(
      screen.getByText(/Deck has 3 Strength support cards/),
    ).toBeInTheDocument();
  });

  it("omits tradeoffs/patterns sections when their lists are empty", () => {
    const minimal = { ...fullCoaching, keyTradeoffs: [], teachingCallouts: [] };
    render(<CardPickCoaching coaching={minimal} />);
    expect(screen.queryByText(/Tradeoffs/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Patterns to remember/)).not.toBeInTheDocument();
    // Briefs still visible.
    expect(screen.getByText(/14-card healthy deck/)).toBeInTheDocument();
  });

  it("does not render the emoji bullet from the prior design", () => {
    render(<CardPickCoaching coaching={fullCoaching} />);
    fireEvent.click(
      screen.getByRole("button", {
        expanded: false,
        name: /Patterns to remember/i,
      }),
    );
    const calloutItem = screen
      .getByText(/Deck has 3 Strength support cards/)
      .closest("li");
    expect(calloutItem?.textContent ?? "").not.toContain("💡");
  });
});
