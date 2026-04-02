/**
 * STS2 Replay Design Tokens
 *
 * Centralized design constants for the companion app.
 * See design-system.md for rationale and full documentation.
 */

// --- Card Type Colors ---

export const CARD_TYPE_COLORS: Record<string, { text: string; bg: string; border: string; label: string }> = {
  Attack: { text: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", label: "ATK" },
  Skill: { text: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20", label: "SKL" },
  Power: { text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", label: "PWR" },
  Curse: { text: "text-zinc-500", bg: "bg-zinc-500/10", border: "border-zinc-500/20", label: "CRS" },
  Status: { text: "text-zinc-500", bg: "bg-zinc-500/10", border: "border-zinc-500/20", label: "STS" },
};

// --- Card Rarity Colors ---

export const RARITY_COLORS: Record<string, { text: string; accent: string; border: string }> = {
  Basic: { text: "text-zinc-500", accent: "from-zinc-600", border: "border-zinc-600/30" },
  Common: { text: "text-zinc-400", accent: "from-zinc-500", border: "border-zinc-500/30" },
  Uncommon: { text: "text-blue-400", accent: "from-blue-500", border: "border-blue-500/30" },
  Rare: { text: "text-amber-400", accent: "from-amber-500", border: "border-amber-500/30" },
  Special: { text: "text-purple-400", accent: "from-purple-500", border: "border-purple-500/30" },
  Event: { text: "text-green-400", accent: "from-green-500", border: "border-green-500/30" },
  Curse: { text: "text-red-500", accent: "from-red-600", border: "border-red-600/30" },
};

// --- Intent Colors ---

export const INTENT_COLORS: Record<string, string> = {
  Attack: "bg-red-500/15 text-red-400 border-red-500/25",
  Defend: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  Buff: "bg-orange-500/15 text-orange-400 border-orange-500/25",
  Debuff: "bg-purple-500/15 text-purple-400 border-purple-500/25",
  Summon: "bg-teal-500/15 text-teal-400 border-teal-500/25",
  Unknown: "bg-zinc-700/40 text-zinc-400 border-zinc-600/30",
};

// --- Map Node Colors ---

export const NODE_COLORS: Record<string, { fill: string; dim: string }> = {
  Monster: { fill: "#ef4444", dim: "#7f1d1d" },
  Elite: { fill: "#f59e0b", dim: "#78350f" },
  Boss: { fill: "#dc2626", dim: "#7f1d1d" },
  RestSite: { fill: "#34d399", dim: "#064e3b" },
  Shop: { fill: "#60a5fa", dim: "#1e3a5f" },
  Treasure: { fill: "#a855f7", dim: "#581c87" },
  Unknown: { fill: "#71717a", dim: "#3f3f46" },
};

// --- Status Effect Colors ---

export const STATUS_COLORS = {
  buff: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  debuff: "bg-red-500/10 text-red-400 border-red-500/20",
} as const;

// --- Shop Category Accent Colors ---

export const SHOP_CATEGORY_ACCENT: Record<string, string> = {
  card: "from-blue-500",
  relic: "from-purple-500",
  potion: "from-emerald-500",
  card_removal: "from-red-500",
};

// --- Rest Site Option Accents ---

export const REST_OPTION_ACCENT: Record<string, string> = {
  HEAL: "from-red-500",
  SMITH: "from-blue-500",
  LIFT: "from-amber-500",
  TOKE: "from-emerald-500",
  DIG: "from-purple-500",
  RECALL: "from-cyan-500",
  MEND: "from-pink-500",
  REVIVE: "from-amber-400",
};
