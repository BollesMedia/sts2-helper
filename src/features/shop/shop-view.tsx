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

interface ShopViewProps {
  state: ShopState;
  deckCards: CombatCard[];
  player: TrackedPlayer | null;
}

export function ShopView({ state, deckCards, player }: ShopViewProps) {
  const { evaluation, isLoading, error } = useShopEvaluation(
    state,
    deckCards,
    player
  );

  const items = state.shop.items.filter((i) => i.is_stocked);
  const cards = items.filter((i) => i.category === "card");
  const relics = items.filter((i) => i.category === "relic");
  const potions = items.filter((i) => i.category === "potion");
  const cardRemoval = items.find((i) => i.category === "card_removal");

  const normalize = (s: string) =>
    s.toLowerCase().replace(/[+\s_]/g, "").replace(/plus$/, "");

  const findEval = (item: ShopItem) => {
    const id = getItemId(item);
    const name = getItemName(item);
    return evaluation?.rankings.find(
      (r) =>
        r.itemId.toLowerCase() === id.toLowerCase() ||
        r.itemName.toLowerCase() === name.toLowerCase() ||
        normalize(r.itemId) === normalize(id) ||
        normalize(r.itemId) === normalize(name) ||
        normalize(r.itemName) === normalize(name)
    );
  };

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">Shop</h2>
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

      {error && (
        <p className="text-sm text-red-400">Evaluation error: {error}</p>
      )}

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
              <h3 className="mb-2 text-sm font-medium text-zinc-400">Cards</h3>
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
              <h3 className="mb-2 text-sm font-medium text-zinc-400">Relics</h3>
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
              <h3 className="mb-2 text-sm font-medium text-zinc-400">Potions</h3>
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
              <h3 className="mb-2 text-sm font-medium text-zinc-400">Services</h3>
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
    </div>
  );
}
