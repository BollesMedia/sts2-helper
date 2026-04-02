"use client";

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

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-zinc-100">Shop</h2>
          <span className="text-xs text-zinc-500">
            {state.shop?.player?.gold ?? 0}g
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
        <div className="space-y-2">
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
                />
              ))}
            </ShopSection>
          )}
        </div>

        {/* Right column: Relics, Potions, Services */}
        <div className="space-y-2">
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
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
        <span className="h-px flex-1 bg-gradient-to-r from-zinc-700/50 to-transparent" />
        {title}
        <span className="h-px flex-1 bg-gradient-to-l from-zinc-700/50 to-transparent" />
      </h3>
      <div className="space-y-1.5">{children}</div>
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
}: ShopRowProps) {
  const rec = evaluation?.recommendation;
  const isStrongPick = rec === "strong_pick";
  const border = rec
    ? RECOMMENDATION_BORDER[rec] ?? "border-zinc-800"
    : "border-zinc-700/40";

  // Build tooltip: description + reasoning
  const tooltip = [description, evaluation?.reasoning].filter(Boolean).join(" — ");

  return (
    <div
      className={cn(
        "rounded-lg border bg-zinc-900/60 transition-all duration-200",
        border,
        !affordable && "opacity-40",
        isStrongPick && affordable && "border-emerald-500/50 shadow-[0_0_12px_rgba(52,211,153,0.15)]",
        "hover:bg-zinc-800/60"
      )}
      title={tooltip}
    >
      {/* Compact row — no expand, hover tooltip for details */}
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        {evaluation && <TierBadge tier={evaluation.tier} size="sm" glow={isStrongPick && affordable} />}
        <span className={cn(
          "text-xs truncate flex-1",
          isStrongPick && affordable ? "text-zinc-50 font-medium" : "text-zinc-200"
        )}>{name}</span>
        {rec && (
          <span
            className={cn(
              "rounded px-1 py-0.5 text-[9px] font-medium shrink-0 border",
              isStrongPick ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : RECOMMENDATION_CHIP[rec] + " border-transparent"
            )}
          >
            {RECOMMENDATION_LABEL[rec]}
          </span>
        )}
        <span className={cn("text-[10px] shrink-0", TYPE_COLORS[type] ?? "text-zinc-500")}>
          {type}
        </span>
        <span
          className={cn(
            "text-[10px] font-medium shrink-0 tabular-nums",
            affordable ? "text-amber-400" : "text-zinc-600"
          )}
        >
          {onSale && <span className="text-emerald-400 mr-1">SALE</span>}
          {cost}g
        </span>
      </div>
    </div>
  );
}
