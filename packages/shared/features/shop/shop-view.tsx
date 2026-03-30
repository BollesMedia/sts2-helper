"use client";

import { useState } from "react";
import { cn } from "../../lib/cn";
import type { ShopState, ShopItem, CombatCard } from "../../types/game-state";
import type { TrackedPlayer } from "../connection/use-player-tracker";
import type { CardEvaluation } from "../../evaluation/types";
import {
  useShopEvaluation,
  getItemId,
  getItemName,
  getItemDescription,
} from "./use-shop-evaluation";
import { TierBadge } from "../../components/tier-badge";
import { EvalError } from "../../components/eval-error";
import {
  RECOMMENDATION_BORDER,
  RECOMMENDATION_CHIP,
  RECOMMENDATION_LABEL,
} from "../../lib/recommendation-styles";

interface ShopViewProps {
  state: ShopState;
  deckCards: CombatCard[];
  player: TrackedPlayer | null;
  runId: string | null;
}

const TYPE_COLORS: Record<string, string> = {
  Attack: "text-red-400",
  Skill: "text-blue-400",
  Power: "text-amber-400",
  Relic: "text-purple-400",
  Potion: "text-emerald-400",
  Service: "text-cyan-400",
};

export function ShopView({ state, deckCards, player, runId }: ShopViewProps) {
  const { evaluation, isLoading, error, retry } = useShopEvaluation(
    state,
    deckCards,
    player,
    runId
  );
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const items = state.shop.items.filter((i) => i.is_stocked);
  const cards = items.filter((i) => i.category === "card");
  const relics = items.filter((i) => i.category === "relic");
  const potions = items.filter((i) => i.category === "potion");
  const cardRemoval = items.find((i) => i.category === "card_removal");

  const stockedItems = items;

  const findEval = (item: ShopItem) => {
    const itemIdx = stockedItems.indexOf(item);
    const id = getItemId(item);
    const name = getItemName(item);
    return evaluation?.rankings.find(
      (r) =>
        r.itemIndex === itemIdx ||
        r.itemId.toLowerCase() === id.toLowerCase() ||
        r.itemName.toLowerCase() === name.toLowerCase()
    );
  };

  const toggle = (key: string) =>
    setExpandedItem((prev) => (prev === key ? null : key));

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-zinc-100">Shop</h2>
          <span className="text-xs text-zinc-500">
            {state.shop.player.gold}g
          </span>
        </div>
        {isLoading && (
          <span className="text-xs text-zinc-500 animate-pulse">
            Evaluating...
          </span>
        )}
      </div>

      {/* Spending plan */}
      {evaluation?.spendingPlan && (
        <p className="text-xs text-blue-300 shrink-0">
          {evaluation.spendingPlan}
        </p>
      )}

      {error && <EvalError error={error} onRetry={retry} />}

      {/* Items — two columns */}
      <div className="flex-1 min-h-0 grid grid-cols-2 gap-x-4 gap-y-3 content-start overflow-y-auto">
        {/* Left column: Cards */}
        <div className="space-y-3">
          {cards.length > 0 && (
            <ShopSection title="Cards">
              {cards.map((item) => (
                <ShopRow
                  key={item.index}
                  name={getItemName(item)}
                  description={getItemDescription(item)}
                  cost={item.cost}
                  type={item.card_type ?? "Card"}
                  rarity={item.card_rarity}
                  affordable={item.can_afford}
                  onSale={item.on_sale}
                  evaluation={findEval(item) ?? null}
                  expanded={expandedItem === `card-${item.index}`}
                  onToggle={() => toggle(`card-${item.index}`)}
                />
              ))}
            </ShopSection>
          )}
        </div>

        {/* Right column: Relics, Potions, Services */}
        <div className="space-y-3">
          {relics.length > 0 && (
            <ShopSection title="Relics">
              {relics.map((item) => (
                <ShopRow
                  key={item.index}
                  name={getItemName(item)}
                  description={getItemDescription(item)}
                  cost={item.cost}
                  type="Relic"
                  affordable={item.can_afford}
                  evaluation={findEval(item) ?? null}
                  expanded={expandedItem === `relic-${item.index}`}
                  onToggle={() => toggle(`relic-${item.index}`)}
                />
              ))}
            </ShopSection>
          )}

          {potions.length > 0 && (
            <ShopSection title="Potions">
              {potions.map((item) => (
                <ShopRow
                  key={item.index}
                  name={getItemName(item)}
                  description={getItemDescription(item)}
                  cost={item.cost}
                  type="Potion"
                  affordable={item.can_afford}
                  evaluation={findEval(item) ?? null}
                  expanded={expandedItem === `potion-${item.index}`}
                  onToggle={() => toggle(`potion-${item.index}`)}
                />
              ))}
            </ShopSection>
          )}

          {cardRemoval && (
            <ShopSection title="Services">
              <ShopRow
                name="Card Removal"
                description="Remove a card from your deck"
                cost={cardRemoval.cost}
                type="Service"
                affordable={cardRemoval.can_afford}
                evaluation={findEval(cardRemoval) ?? null}
                expanded={expandedItem === "removal"}
                onToggle={() => toggle("removal")}
              />
            </ShopSection>
          )}
        </div>
      </div>
    </div>
  );
}

function ShopSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600">
        {title}
      </h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

interface ShopRowProps {
  name: string;
  description: string;
  cost: number;
  type: string;
  rarity?: string;
  affordable: boolean;
  onSale?: boolean;
  evaluation: CardEvaluation | null;
  expanded: boolean;
  onToggle: () => void;
}

function ShopRow({
  name,
  description,
  cost,
  type,
  rarity,
  affordable,
  onSale,
  evaluation,
  expanded,
  onToggle,
}: ShopRowProps) {
  const rec = evaluation?.recommendation;
  const border = rec
    ? RECOMMENDATION_BORDER[rec] ?? "border-zinc-800"
    : "border-zinc-800";

  return (
    <div
      className={cn(
        "rounded border bg-zinc-900/50 transition-colors cursor-pointer",
        border,
        !affordable && "opacity-50"
      )}
      onClick={onToggle}
    >
      {/* Compact row */}
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        {evaluation && <TierBadge tier={evaluation.tier} size="sm" />}
        <span className="text-sm text-zinc-100 truncate flex-1">{name}</span>
        {rec && (
          <span
            className={cn(
              "rounded px-1 py-0.5 text-[10px] font-medium shrink-0",
              RECOMMENDATION_CHIP[rec]
            )}
          >
            {RECOMMENDATION_LABEL[rec]}
          </span>
        )}
        <span className={cn("text-xs shrink-0", TYPE_COLORS[type] ?? "text-zinc-500")}>
          {type}
        </span>
        <span
          className={cn(
            "text-xs font-medium shrink-0 tabular-nums",
            affordable ? "text-amber-400" : "text-zinc-600"
          )}
        >
          {onSale && <span className="text-emerald-400 mr-1">SALE</span>}
          {cost}g
        </span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-2.5 pb-2 space-y-1 border-t border-zinc-800/50">
          <p className="text-xs text-zinc-500 pt-1.5">{description}</p>
          {rarity && (
            <span className="text-[10px] text-zinc-600">{rarity}</span>
          )}
          {evaluation && (
            <p className="text-xs text-zinc-300">{evaluation.reasoning}</p>
          )}
        </div>
      )}
    </div>
  );
}
