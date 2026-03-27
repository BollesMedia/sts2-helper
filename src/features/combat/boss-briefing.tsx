"use client";

import useSWR from "swr";
import { createClient } from "@/lib/supabase/client";
import type { Monster } from "@/lib/supabase/helpers";
import type { Enemy } from "@/lib/types/game-state";

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
}

export function BossBriefing({ enemies, ascension }: BossBriefingProps) {
  const enemyIds = enemies.map((e) => e.entity_id);
  const cacheKey = enemyIds.sort().join(",");

  const { data: bossData } = useSWR(
    `boss-briefing:${cacheKey}`,
    () => fetchBossData(enemyIds),
    { revalidateOnFocus: false, dedupingInterval: 1000 * 60 * 60 }
  );

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
    </div>
  );
}
