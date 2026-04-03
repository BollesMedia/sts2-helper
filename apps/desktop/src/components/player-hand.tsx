import type { CombatCard } from "@sts2/shared/types/game-state";

interface PlayerHandProps {
  cards: CombatCard[];
}

export function PlayerHand({ cards }: PlayerHandProps) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto">
      <span className="text-[9px] font-medium text-spire-text-muted shrink-0 mr-1">
        Hand ({cards.length})
      </span>
      {cards.map((card, i) => (
        <span
          key={i}
          className="rounded border border-spire-border bg-spire-elevated/60 px-2 py-0.5 text-[10px] text-spire-text-secondary whitespace-nowrap shrink-0"
        >
          {card.name}
        </span>
      ))}
      {cards.length === 0 && (
        <span className="text-[10px] text-spire-text-muted italic">No cards</span>
      )}
    </div>
  );
}
