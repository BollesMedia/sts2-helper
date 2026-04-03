"use client";

import type { GameState } from "@sts2/shared/types/game-state";

export function CombatRewardsView({
  state,
}: {
  state: Extract<GameState, { state_type: "combat_rewards" }>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-zinc-100">Rewards</h2>
      <div className="space-y-2">
        {state.rewards.items.map((item) => (
          <div
            key={item.index}
            className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 flex items-center gap-3"
          >
            <span className="text-lg">
              {item.type === "gold" ? "💰" : item.type === "card" ? "🃏" : item.type === "potion" ? "🧪" : item.type === "relic" ? "💎" : "📦"}
            </span>
            <span className="text-sm text-zinc-200">{item.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
