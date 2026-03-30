import type { MapState, MapNode, MapNextOption } from "@sts2/shared/types/game-state";
import type { TrackedPlayer } from "@sts2/shared/features/connection/use-player-tracker";

interface PathScore {
  option: MapNextOption;
  score: number;
  reasons: string[];
}

const NODE_TYPE_ICONS: Record<string, string> = {
  Monster: "⚔️",
  Elite: "💀",
  Boss: "👹",
  RestSite: "🔥",
  Shop: "💰",
  Treasure: "📦",
  Unknown: "❓",
};

const NODE_TYPE_COLORS: Record<string, string> = {
  Monster: "fill-red-400",
  Elite: "fill-amber-400",
  Boss: "fill-red-600",
  RestSite: "fill-emerald-400",
  Shop: "fill-blue-400",
  Treasure: "fill-amber-300",
  Unknown: "fill-zinc-400",
};

const NODE_TYPE_STROKE: Record<string, string> = {
  Monster: "stroke-red-400/50",
  Elite: "stroke-amber-400/50",
  Boss: "stroke-red-600/50",
  RestSite: "stroke-emerald-400/50",
  Shop: "stroke-blue-400/50",
  Treasure: "stroke-amber-300/50",
  Unknown: "stroke-zinc-400/50",
};

export function scoreNextOptions(
  mapState: MapState["map"],
  player: TrackedPlayer | null,
  deckSize: number
): PathScore[] {
  const hpPercent = player
    ? player.hp / Math.max(1, player.maxHp)
    : 1;
  const gold = player?.gold ?? 0;

  return mapState.next_options.map((option) => {
    let score = 50; // baseline
    const reasons: string[] = [];

    // Score the immediate node
    const immediateScore = scoreNodeType(option.type, hpPercent, gold, deckSize);
    score += immediateScore.score;
    reasons.push(...immediateScore.reasons);

    // Score lookahead (what this leads to)
    if (option.leads_to && option.leads_to.length > 0) {
      for (const child of option.leads_to) {
        const childScore = scoreNodeType(child.type, hpPercent, gold, deckSize);
        // Lookahead is worth half
        score += childScore.score * 0.5;
        if (childScore.reasons.length > 0) {
          reasons.push(`leads to ${child.type}`);
        }
      }
    }

    return { option, score, reasons };
  });
}

function scoreNodeType(
  type: string,
  hpPercent: number,
  gold: number,
  deckSize: number
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  switch (type) {
    case "Monster":
      score = 5; // baseline positive — card rewards and gold
      if (hpPercent < 0.3) {
        score -= 10;
        reasons.push("Low HP — fights are risky");
      }
      break;

    case "Elite":
      if (hpPercent > 0.7) {
        score = 15;
        reasons.push("Healthy enough for elite — relic reward");
      } else if (hpPercent > 0.4) {
        score = 0;
        reasons.push("Elite is risky at this HP");
      } else {
        score = -20;
        reasons.push("Too low for elite");
      }
      break;

    case "RestSite":
      if (hpPercent < 0.5) {
        score = 20;
        reasons.push("Need healing");
      } else if (hpPercent < 0.8) {
        score = 10;
        reasons.push("Rest site available for heal or upgrade");
      } else {
        score = 5;
        reasons.push("Can upgrade a card");
      }
      break;

    case "Shop":
      if (gold > 100) {
        score = 12;
        reasons.push("Have gold to spend");
      } else if (gold > 50) {
        score = 5;
        reasons.push("Shop available");
      } else {
        score = 0;
        reasons.push("Low gold for shop");
      }
      // Card removal is valuable with larger decks
      if (deckSize > 15) {
        score += 5;
        reasons.push("Deck needs thinning");
      }
      break;

    case "Treasure":
      score = 8;
      reasons.push("Free relic");
      break;

    case "Unknown":
      score = 3;
      reasons.push("Random event");
      break;

    case "Boss":
      score = 0;
      break;
  }

  return { score, reasons };
}

export { NODE_TYPE_ICONS, NODE_TYPE_COLORS, NODE_TYPE_STROKE };
