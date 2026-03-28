"use client";

import type { ShopState, ShopItem, CombatCard } from "@/lib/types/game-state";
import type { TrackedPlayer } from "@/features/connection/use-player-tracker";
import {
  useShopEvaluation,
  getItemId,
  getItemName,
  getItemDescription,
} from "./use-shop-evaluation";
import { ShopItemCard } from "./shop-item-card";
import { CardSkeleton } from "@/components/loading-skeleton";
import { RefineInput } from "@/components/refine-input";
import { EvalError } from "@/components/eval-error";

interface ShopViewProps {
  state: ShopState;
  deckCards: CombatCard[];
  player: TrackedPlayer | null;
  runId: string | null;
}

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

  // Build a lookup from item index in the stocked items array to shop item
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
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold text-zinc-100">Shop</h2>
        {isLoading && (
          <span className="text-xs text-zinc-500 animate-pulse">
            Evaluating...
          </span>
        )}
        {evaluation && !isLoading && (
          <span className="text-xs text-zinc-600">
            {evaluation.rankings[0]?.source === "statistical"
              ? "From historical data"
              : "Claude evaluation"}
          </span>
        )}
      </div>

      {/* Spending plan */}
      {evaluation?.spendingPlan && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 px-4 py-3">
          <p className="text-sm text-blue-300">{evaluation.spendingPlan}</p>
        </div>
      )}

      {error && <EvalError error={error} onRetry={retry} />}

      {isLoading && !evaluation ? (
        <div className="grid grid-cols-3 gap-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : (
        <>
          {cards.length > 0 && (
            <div>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">Cards</h3>
              <div className="grid grid-cols-3 gap-3">
                {cards.map((item) => {
                  const ev = findEval(item);
                  return (
                    <ShopItemCard
                      key={item.index}
                      name={getItemName(item)}
                      description={getItemDescription(item)}
                      cost={item.cost}
                      type={item.card_type ?? "Card"}
                      rarity={item.card_rarity}
                      affordable={item.can_afford}
                      onSale={item.on_sale}
                      evaluation={ev ?? null}
                      rank={ev?.rank}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {relics.length > 0 && (
            <div>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">Relics</h3>
              <div className="grid grid-cols-3 gap-3">
                {relics.map((item) => {
                  const ev = findEval(item);
                  return (
                    <ShopItemCard
                      key={item.index}
                      name={getItemName(item)}
                      description={getItemDescription(item)}
                      cost={item.cost}
                      type="Relic"
                      affordable={item.can_afford}
                      evaluation={ev ?? null}
                      rank={ev?.rank}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {potions.length > 0 && (
            <div>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">Potions</h3>
              <div className="grid grid-cols-3 gap-3">
                {potions.map((item) => {
                  const ev = findEval(item);
                  return (
                    <ShopItemCard
                      key={item.index}
                      name={getItemName(item)}
                      description={getItemDescription(item)}
                      cost={item.cost}
                      type="Potion"
                      affordable={item.can_afford}
                      evaluation={ev ?? null}
                      rank={ev?.rank}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {cardRemoval && (
            <div>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">Services</h3>
              <div className="grid grid-cols-3 gap-3">
                <ShopItemCard
                  name="Card Removal"
                  description="Remove a card from your deck"
                  cost={cardRemoval.cost}
                  type="Service"
                  affordable={cardRemoval.can_afford}
                  evaluation={findEval(cardRemoval) ?? null}
                  rank={findEval(cardRemoval)?.rank}
                />
              </div>
            </div>
          )}
        </>
      )}

      {evaluation && !isLoading && (
        <RefineInput
          originalContext={`Shop with ${items.length} items. Gold: ${state.shop.player.gold}g. Items: ${items.map((i) => getItemName(i)).join(", ")}.`}
          originalResponse={[
            evaluation.spendingPlan,
            ...evaluation.rankings.map((r) => `#${r.rank} ${r.itemName}: ${r.reasoning}`),
          ].filter(Boolean).join(" ")}
        />
      )}
    </div>
  );
}
