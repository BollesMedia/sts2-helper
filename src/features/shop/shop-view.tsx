"use client";

import type { ShopState, CombatCard } from "@/lib/types/game-state";
import type { TrackedPlayer } from "@/features/connection/use-player-tracker";
import { useShopEvaluation } from "./use-shop-evaluation";
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
  const shop = state.shop;

  const findEval = (id: string) =>
    evaluation?.rankings.find(
      (r) =>
        r.itemId.toLowerCase() === id.toLowerCase() ||
        r.itemName.toLowerCase() === id.toLowerCase()
    );

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
        <div className="grid grid-cols-2 gap-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : (
        <>
          {/* Cards */}
          {shop.cards.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-zinc-400">Cards</h3>
              <div className="grid grid-cols-3 gap-3">
                {shop.cards.map((card) => {
                  const ev = findEval(card.id);
                  return (
                    <ShopItemCard
                      key={card.id}
                      name={card.name}
                      description={card.description}
                      cost={card.cost_gold}
                      type={card.type}
                      rarity={card.rarity}
                      affordable={card.affordable}
                      onSale={card.on_sale}
                      evaluation={ev ?? null}
                      rank={ev?.rank}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Relics */}
          {shop.relics.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-zinc-400">
                Relics
              </h3>
              <div className="grid grid-cols-3 gap-3">
                {shop.relics.map((relic) => {
                  const ev = findEval(relic.id);
                  return (
                    <ShopItemCard
                      key={relic.id}
                      name={relic.name}
                      description={relic.description}
                      cost={relic.cost_gold}
                      type="Relic"
                      affordable={relic.affordable}
                      evaluation={ev ?? null}
                      rank={ev?.rank}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Potions */}
          {shop.potions.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-zinc-400">
                Potions
              </h3>
              <div className="grid grid-cols-3 gap-3">
                {shop.potions.map((potion) => {
                  const ev = findEval(potion.id);
                  return (
                    <ShopItemCard
                      key={potion.id}
                      name={potion.name}
                      description={potion.description}
                      cost={potion.cost_gold}
                      type="Potion"
                      affordable={potion.affordable}
                      evaluation={ev ?? null}
                      rank={ev?.rank}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Card Removal */}
          {shop.card_removal && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-zinc-400">
                Services
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <ShopItemCard
                  name="Card Removal"
                  description="Remove a card from your deck"
                  cost={shop.card_removal.cost}
                  type="Service"
                  affordable={shop.card_removal.affordable}
                  evaluation={findEval("CARD_REMOVAL") ?? null}
                  rank={findEval("CARD_REMOVAL")?.rank}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
