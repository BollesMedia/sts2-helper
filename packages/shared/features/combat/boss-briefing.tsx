"use client";
import { apiUrl } from "../../lib/api-client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { createClient } from "../../supabase/client";
import type { Monster } from "../../supabase/helpers";
import type { Enemy, CombatCard } from "../../types/game-state";

const supabase = createClient();

interface MoveInfo {
  name: string;
  intent: string;
  damage?: { normal: number; ascension: number; hit_count: number | null };
  block?: number;
  heal?: number;
  powers?: { power_id: string; target: string; amount: number }[];
}

function formatMove(move: MoveInfo, ascension: number): string {
  const parts: string[] = [move.intent];

  if (move.damage) {
    const dmg = ascension >= 8 ? move.damage.ascension : move.damage.normal;
    if (move.damage.hit_count && move.damage.hit_count > 1) {
      parts.push(`${dmg}x${move.damage.hit_count} dmg`);
    } else {
      parts.push(`${dmg} dmg`);
    }
  }

  if (move.block) parts.push(`${move.block} block`);
  if (move.heal) parts.push(`${move.heal} heal`);

  if (move.powers) {
    for (const p of move.powers) {
      const id = p.power_id.replace(/_/g, " ").toLowerCase();
      parts.push(`${id} x${p.amount}`);
    }
  }

  return parts.join(" · ");
}

async function fetchBossData(enemyIds: string[]): Promise<Monster[]> {
  // Strip numeric suffixes from entity IDs (KIN_PRIEST_0 -> KIN_PRIEST)
  const baseIds = [...new Set(enemyIds.map((id) => id.replace(/_\d+$/, "")))];

  const { data } = await supabase
    .from("monsters")
    .select("*")
    .in("id", baseIds);

  return data ?? [];
}

interface BossBriefingProps {
  enemies: Enemy[];
  ascension: number;
  deckCards: CombatCard[];
}

export function BossBriefing({ enemies, ascension, deckCards }: BossBriefingProps) {
  const enemyIds = enemies.map((e) => e.entity_id);
  const cacheKey = enemyIds.sort().join(",");

  const { data: bossData } = useSWR(
    `boss-briefing:${cacheKey}`,
    () => fetchBossData(enemyIds),
    { revalidateOnFocus: false, dedupingInterval: 1000 * 60 * 60 }
  );

  const [strategy, setStrategy] = useState<string | null>(null);
  const [strategyLoading, setStrategyLoading] = useState(false);
  const strategyFetched = useRef(false);

  // Fetch strategy from Claude grounded in real move data
  if (bossData && bossData.length > 0 && !strategyFetched.current && !strategyLoading && deckCards.length > 0) {
    strategyFetched.current = true;
    setStrategyLoading(true);

    const bossMoveSummary = bossData
      .map((b) => {
        const moves = (b.moves as MoveInfo[] | null) ?? [];
        const moveStr = moves
          .map((m) => `${m.name}: ${formatMove(m, ascension)}`)
          .join("; ");
        return `${b.name} (${b.min_hp}HP): ${moveStr}`;
      })
      .join("\n");

    const deckSummary = deckCards.map((c) => c.name).join(", ");

    fetch(apiUrl("/api/evaluate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "map",
        context: null,
        mapPrompt: `You are fighting this boss in Slay the Spire 2. Based ONLY on the move data below and the player's deck, provide a concise 2-3 sentence strategy. Do NOT invent moves or mechanics not listed.

Boss moves:
${bossMoveSummary}

Player deck: ${deckSummary}

Respond as JSON:
{"strategy": "2-3 sentences of grounded tactical advice based on the actual moves listed above"}`,
        runId: null,
        gameVersion: null,
      }),
    })
      .then((r) => r.json())
      .then((d) => setStrategy(d.strategy ?? null))
      .catch(() => setStrategy(null))
      .finally(() => setStrategyLoading(false));
  }

  if (!bossData || bossData.length === 0) return null;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        Boss Briefing
      </h3>
      {bossData.map((boss) => {
        const moves = (boss.moves as MoveInfo[] | null) ?? [];
        return (
          <div key={boss.id} className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-200">
                {boss.name}
              </span>
              <span className="text-xs text-zinc-500">
                {boss.min_hp}{boss.max_hp ? `–${boss.max_hp}` : ""} HP
              </span>
            </div>
            <div className="space-y-1">
              {moves.map((move, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-zinc-300">{move.name}</span>
                  <span className="text-zinc-500">{formatMove(move, ascension)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Strategy */}
      {strategyLoading && (
        <p className="text-xs text-zinc-500 animate-pulse">Analyzing strategy...</p>
      )}
      {strategy && (
        <div className="border-t border-zinc-800 pt-3">
          <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500 mb-1">
            Strategy
          </h4>
          <p className="text-sm text-zinc-300 leading-relaxed">{strategy}</p>
        </div>
      )}
    </div>
  );
}
