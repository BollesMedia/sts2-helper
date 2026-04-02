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
  RECOMMENDATION_CHIP,
  RECOMMENDATION_LABEL,
} from "../../lib/recommendation-styles";

interface ShopViewProps {
  state: ShopState;
  deckCards: CombatCard[];
  player: TrackedPlayer | null;
  runId: string | null;
}

const CATEGORY_ACCENT: Record<string, string> = {
  card: "from-blue-500",
  relic: "from-purple-500",
  potion: "from-emerald-500",
  card_removal: "from-red-500",
};

const TYPE_COLOR: Record<string, string> = {
  Attack: "text-red-400",
  Skill: "text-blue-400",
  Power: "text-amber-400",
  Relic: "text-purple-400",
  Potion: "text-emerald-400",
  Service: "text-cyan-400",
};

export function ShopView({ state, deckCards, player, runId }: ShopViewProps) {
  const { evaluation, isLoading, error, retry } = useShopEvaluation(
    state, deckCards, player, runId
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
          <h2 className="text-sm font-display font-bold text-spire-text">Shop</h2>
          <span className="text-xs font-mono tabular-nums text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
            {(state.player ?? state.shop?.player)?.gold ?? 0}g
          </span>
        </div>
        {isLoading && (
          <span className="text-[10px] font-mono text-zinc-500 bg-zinc-900/80 px-2 py-0.5 rounded border border-zinc-800 animate-pulse">
            Evaluating...
          </span>
        )}
      </div>

      {/* Spending plan */}
      {evaluation?.spendingPlan && (
        <div className="rounded border border-blue-500/20 bg-blue-950/20 px-2.5 py-1.5 shrink-0">
          <p className="text-xs text-blue-300 leading-relaxed">
            {evaluation.spendingPlan}
          </p>
        </div>
      )}

      {error && <EvalError error={error} onRetry={retry} />}

      {/* Items — two columns */}
      <div className="flex-1 min-h-0 grid grid-cols-2 gap-x-3 gap-y-2 content-start overflow-y-auto">
        {/* Left column: Cards */}
        <div className="space-y-2">
          {cards.length > 0 && (
            <ShopSection title="Cards">
              {cards.map((item) => (
                <ShopItemCard
                  key={item.index}
                  item={item}
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
                <ShopItemCard
                  key={item.index}
                  item={item}
                  evaluation={findEval(item) ?? null}
                />
              ))}
            </ShopSection>
          )}

          {potions.length > 0 && (
            <ShopSection title="Potions">
              {potions.map((item) => (
                <ShopItemCard
                  key={item.index}
                  item={item}
                  evaluation={findEval(item) ?? null}
                />
              ))}
            </ShopSection>
          )}

          {cardRemoval && (
            <ShopSection title="Services">
              <ShopItemCard
                item={cardRemoval}
                evaluation={findEval(cardRemoval) ?? null}
              />
            </ShopSection>
          )}
        </div>
      </div>
    </div>
  );
}

function ShopSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-600 flex items-center gap-2">
        <span className="h-px flex-1 bg-gradient-to-r from-zinc-700/50 to-transparent" />
        {title}
        <span className="h-px flex-1 bg-gradient-to-l from-zinc-700/50 to-transparent" />
      </h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function ShopItemCard({ item, evaluation }: { item: ShopItem; evaluation: CardEvaluation | null }) {
  const name = getItemName(item);
  const description = getItemDescription(item);
  const type = item.category === "card" ? (item.card_type ?? "Card") : item.category === "card_removal" ? "Service" : item.category;
  const rec = evaluation?.recommendation;
  const isStrongPick = rec === "strong_pick";
  const accent = CATEGORY_ACCENT[item.category] ?? "from-zinc-600";

  const tooltip = [description, evaluation?.reasoning].filter(Boolean).join(" \u2014 ");

  return (
    <div
      className={cn(
        "rounded-lg border bg-zinc-900/70 relative overflow-hidden transition-all duration-150",
        !item.can_afford && "opacity-35",
        isStrongPick && item.can_afford
          ? "border-emerald-500/50 shadow-[0_0_12px_rgba(52,211,153,0.12)]"
          : rec === "good_pick"
            ? "border-blue-500/30"
            : rec === "situational"
              ? "border-amber-500/30"
              : "border-zinc-800",
        item.can_afford && "hover:bg-zinc-800/60"
      )}
      title={tooltip}
    >
      {/* Category accent edge */}
      <div className={cn("absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b to-transparent", accent)} />

      <div className="flex items-center gap-2 px-2.5 py-2 pl-3">
        {evaluation && <TierBadge tier={evaluation.tier} size="sm" glow={isStrongPick && item.can_afford} />}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={cn(
              "text-xs font-medium truncate",
              isStrongPick && item.can_afford ? "text-zinc-50" : "text-zinc-200"
            )}>
              {name}
            </span>
            {item.on_sale && (
              <span className="text-[8px] font-bold uppercase text-emerald-400 bg-emerald-500/15 px-1 py-px rounded border border-emerald-500/25">
                Sale
              </span>
            )}
          </div>
          {/* Description + reasoning preview */}
          {evaluation?.reasoning && (
            <p className="text-[9px] text-zinc-600 truncate mt-0.5">{evaluation.reasoning}</p>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {rec && (
            <span className={cn(
              "rounded px-1 py-0.5 text-[8px] font-semibold border",
              isStrongPick ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : RECOMMENDATION_CHIP[rec] + " border-transparent"
            )}>
              {RECOMMENDATION_LABEL[rec]}
            </span>
          )}
          <span className={cn("text-[10px] shrink-0", TYPE_COLOR[type] ?? "text-zinc-500")}>
            {type}
          </span>
          <span className={cn(
            "text-[10px] font-semibold font-mono tabular-nums",
            item.can_afford ? "text-amber-400" : "text-zinc-600"
          )}>
            {item.cost}g
          </span>
        </div>
      </div>
    </div>
  );
}
