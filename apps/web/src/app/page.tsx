"use client";

import { useState } from "react";
import { useAuth } from "@/features/auth/auth-provider";
import { LoginScreen } from "@/features/auth/login-screen";
import { useGameState, ConnectionBanner } from "@/features/connection";
import { useDeckTracker } from "@/features/connection/use-deck-tracker";
import { usePlayerTracker } from "@/features/connection/use-player-tracker";
import { useRunTracker } from "@/features/connection/use-run-tracker";
import { useChoiceTracker } from "@/evaluation/choice-tracker";
import { CardPickView } from "@/features/card-pick/card-pick-view";
import { ShopView } from "@/features/shop/shop-view";
import { MapView } from "@/features/map/map-view";
import { EventView } from "@/features/event/event-view";
import { RestSiteView } from "@/features/rest-site/rest-site-view";
import { HpBar } from "@/components/hp-bar";
import { BossBriefing } from "@/features/combat/boss-briefing";
import { cn } from "@/lib/cn";
import type {
  GameState,
  CombatState,
  CombatCard,
} from "@/lib/types/game-state";
import type { TrackedPlayer } from "@/features/connection/use-player-tracker";
import { isCombatState, hasRun } from "@/lib/types/game-state";

// ─── State label formatting ───

const STATE_LABELS: Record<string, string> = {
  monster: "Combat",
  elite: "Elite Combat",
  boss: "Boss Fight",
  card_reward: "Card Reward",
  combat_rewards: "Rewards",
  card_select: "Card Select",
  relic_select: "Relic Select",
  hand_select: "Hand Select",
  rest_site: "Rest Site",
  shop: "Shop",
  map: "Map",
  event: "Event",
  treasure: "Treasure",
  menu: "Menu",
};

// ─── Header ───

function AppHeader({
  gameState,
  player,
  onSignOut,
}: {
  gameState: GameState;
  player: TrackedPlayer | null;
  onSignOut?: () => void;
}) {
  const label = STATE_LABELS[gameState.state_type] ?? gameState.state_type;
  const run = hasRun(gameState) ? gameState.run : null;

  return (
    <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-sm font-semibold text-zinc-100 tracking-tight">
            STS2
          </span>
        </div>

        <div className="h-4 w-px bg-zinc-800" />

        <span className="text-sm font-medium text-zinc-300">{label}</span>

        {run && (
          <>
            <div className="h-4 w-px bg-zinc-800" />
            <span className="text-xs font-mono text-zinc-500">
              Act {run.act} · Floor {run.floor}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-5">
        {player && (
          <>
            <span className="text-sm text-zinc-400">{player.character}</span>
            <HpBar current={player.hp} max={player.maxHp} />
            <span className="text-sm font-mono tabular-nums text-amber-400">
              {player.gold}g
            </span>
          </>
        )}
        {onSignOut && (
          <button
            onClick={onSignOut}
            className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}

// ─── View Router ───

function GameStateView({
  state,
  deckCards,
  player,
  runId,
  runState,
}: {
  state: GameState;
  deckCards: CombatCard[];
  player: TrackedPlayer | null;
  runId: string | null;
  runState: import("@/features/connection/use-run-tracker").RunState;
}) {
  if (isCombatState(state)) {
    return <CombatView state={state} deckCards={deckCards} />;
  }

  switch (state.state_type) {
    case "card_reward":
      return <CardPickView state={state} deckCards={deckCards} player={player} runId={runId} />;
    case "shop":
      return <ShopView state={state} deckCards={deckCards} player={player} runId={runId} />;
    case "map":
      return <MapView state={state} player={player} deckCards={deckCards} />;
    case "event":
      return <EventView state={state} deckCards={deckCards} player={player} runId={runId} />;
    case "rest_site":
      return <RestSiteView state={state} deckCards={deckCards} player={player} runId={runId} />;
    case "card_select": {
      const screenType = state.card_select.screen_type;
      if (screenType === "simple_select" || screenType === "choose") {
        // simple_select from events/mystery nodes can be multi-pick
        // card_reward is always exclusive (handled separately)
        const isMultiSelect = screenType === "simple_select";
        const asCardReward = {
          state_type: "card_reward" as const,
          card_reward: {
            cards: state.card_select.cards,
            can_skip: !!state.card_select.can_cancel,
          },
          run: state.run,
        };
        return (
          <div className="flex flex-col gap-6">
            <p className="text-sm text-zinc-400">{state.card_select.prompt}</p>
            <CardPickView state={asCardReward} deckCards={deckCards} player={player} runId={runId} exclusive={!isMultiSelect} />
          </div>
        );
      }
      return <PlaceholderView title="Card Select" state={state} />;
    }
    case "combat_rewards":
      return <CombatRewardsView state={state} />;
    case "menu":
      return <MenuView runState={runState} />;
    default:
      return <PlaceholderView title={STATE_LABELS[state.state_type] ?? state.state_type} state={state} />;
  }
}

// ─── Combat View ───

function CombatView({ state, deckCards }: { state: CombatState; deckCards: CombatCard[] }) {
  if (!state.battle?.player) {
    return <PlaceholderView title="Combat" state={state} />;
  }
  const { player, enemies } = state.battle;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold text-zinc-100">
          {STATE_LABELS[state.state_type] ?? "Combat"}
        </h2>
        <span className="text-xs font-mono text-zinc-600">
          Round {state.battle.round}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Player */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Player
          </h3>
          <div className="flex items-center justify-between">
            <HpBar current={player.hp} max={player.max_hp} />
            <div className="flex items-center gap-3 text-sm font-mono tabular-nums">
              <span className="text-blue-400">{player.energy}/{player.max_energy} E</span>
              <span className="text-cyan-400">{player.block} B</span>
            </div>
          </div>
        </div>

        {/* Enemies */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Enemies
          </h3>
          <div className="space-y-2">
            {enemies.map((enemy) => (
              <div key={enemy.entity_id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-zinc-200">{enemy.name}</span>
                  {enemy.block > 0 && (
                    <span className="text-xs text-cyan-400">{enemy.block} B</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {enemy.intents[0] && (
                    <span className={cn(
                      "rounded px-1.5 py-0.5 text-xs font-medium",
                      enemy.intents[0].type === "Attack" && "bg-red-400/10 text-red-400",
                      enemy.intents[0].type === "Buff" && "bg-amber-400/10 text-amber-400",
                      enemy.intents[0].type === "Debuff" && "bg-purple-400/10 text-purple-400",
                      enemy.intents[0].type === "Defend" && "bg-blue-400/10 text-blue-400",
                      !["Attack", "Buff", "Debuff", "Defend"].includes(enemy.intents[0].type) && "bg-zinc-700/50 text-zinc-400"
                    )}>
                      {enemy.intents[0].title}
                    </span>
                  )}
                  <HpBar current={enemy.hp} max={enemy.max_hp} size="sm" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Hand */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Hand ({player.hand.length})
        </h3>
        <div className="flex flex-wrap gap-2">
          {player.hand.map((card, i) => (
            <span
              key={i}
              className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200"
            >
              {card.name}
            </span>
          ))}
          {player.hand.length === 0 && (
            <span className="text-sm text-zinc-600">No cards in hand</span>
          )}
        </div>
      </div>

      {/* Boss briefing — real move data from DB, no hallucination */}
      {state.state_type === "boss" && (
        <BossBriefing enemies={enemies} ascension={state.run.ascension} deckCards={deckCards} />
      )}

      {/* Status effects */}
      {(player.status.length > 0 || enemies.some((e) => e.status.length > 0)) && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Status Effects
          </h3>
          <div className="space-y-2">
            {player.status.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {player.status.map((s, i) => (
                  <span
                    key={i}
                    className={cn(
                      "rounded px-2 py-0.5 text-xs",
                      s.type === "Buff" ? "bg-emerald-400/10 text-emerald-400" : "bg-red-400/10 text-red-400"
                    )}
                  >
                    {s.name} {s.amount}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Combat Rewards View ───

function CombatRewardsView({
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

// ─── Menu View ───

function MenuView({
  runState,
}: {
  runState: import("@/features/connection/use-run-tracker").RunState;
}) {
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);

  const handleOutcome = (victory: boolean) => {
    if (notes.trim() && runState.endedRunId) {
      fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "end",
          runId: runState.endedRunId,
          notes: notes.trim(),
        }),
      }).catch(console.error);
    }
    runState.confirmOutcome(victory);
    setSaved(true);
  };

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center space-y-4 max-w-md w-full">
        {runState.pendingOutcome ? (
          <>
            <h2 className="text-2xl font-semibold text-zinc-200">
              Run ended on floor {runState.finalFloor}
            </h2>
            <p className="text-sm text-zinc-500">
              How did it go?
            </p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What went wrong? What would you do differently? Any card picks you regret?"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
              rows={3}
            />
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => handleOutcome(true)}
                className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-6 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
              >
                Victory
              </button>
              <button
                onClick={() => handleOutcome(false)}
                className="rounded-lg border border-red-500/40 bg-red-500/10 px-6 py-2 text-sm font-medium text-red-400 hover:bg-red-500/20 transition-colors"
              >
                Defeat
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-semibold text-zinc-200">
              Waiting for run
            </h2>
            <p className="text-sm text-zinc-500">
              Start a new run in Slay the Spire 2
            </p>
          </>
        )}
        <a
          href="/runs"
          className="inline-block text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          View run history
        </a>
      </div>
    </div>
  );
}

// ─── Placeholder ───

function PlaceholderView({
  title,
  state,
}: {
  title: string;
  state: GameState;
}) {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-zinc-100">{title}</h2>
      {hasRun(state) && (
        <p className="text-xs font-mono text-zinc-600">
          Act {state.run.act} · Floor {state.run.floor}
        </p>
      )}
      <p className="text-sm text-zinc-500">
        View coming soon
      </p>
    </div>
  );
}

// ─── Dashboard ───

export default function Dashboard() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-zinc-500">Loading...</p>
      </div>
    );
  }

  // Dev bypass: skip login in development
  const isDev = process.env.NODE_ENV === "development";
  if (!user && !isDev) {
    return <LoginScreen />;
  }

  return <AuthenticatedDashboard />;
}

function AuthenticatedDashboard() {
  const { user, signOut } = useAuth();
  const { gameState, connectionStatus } = useGameState();
  const deckCards = useDeckTracker(gameState);
  const player = usePlayerTracker(gameState);
  const runState = useRunTracker(gameState, user?.id ?? null);
  useChoiceTracker(gameState, deckCards, runState.runId);

  if (connectionStatus !== "connected" || !gameState) {
    return <ConnectionBanner status={connectionStatus} />;
  }

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader gameState={gameState} player={player} onSignOut={signOut} />
      <main className="flex-1 p-6">
        <GameStateView state={gameState} deckCards={deckCards} player={player} runId={runState.runId} runState={runState} />
      </main>
      {gameState.state_type !== "menu" && (
        <footer className="border-t border-zinc-800 px-6 py-2 flex justify-end">
          <button
            onClick={() => {
              localStorage.removeItem("sts2-eval-cache");
              localStorage.removeItem("sts2-shop-eval-cache");
              localStorage.removeItem("sts2-map-eval-cache");
              localStorage.removeItem("sts2-event-eval-cache");
              localStorage.removeItem("sts2-rest-eval-cache");
              window.location.reload();
            }}
            className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            Re-evaluate
          </button>
        </footer>
      )}
    </div>
  );
}
