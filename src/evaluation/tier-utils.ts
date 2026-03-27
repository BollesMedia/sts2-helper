export type TierLetter = "S" | "A" | "B" | "C" | "D" | "F";

const TIER_TO_VALUE: Record<TierLetter, number> = {
  S: 6,
  A: 5,
  B: 4,
  C: 3,
  D: 2,
  F: 1,
};

const VALUE_TO_TIER: Record<number, TierLetter> = {
  6: "S",
  5: "A",
  4: "B",
  3: "C",
  2: "D",
  1: "F",
};

export function tierToValue(tier: TierLetter): number {
  return TIER_TO_VALUE[tier];
}

export function valueToTier(value: number): TierLetter {
  const rounded = Math.round(Math.max(1, Math.min(6, value)));
  return VALUE_TO_TIER[rounded] ?? "C";
}

export function tierColor(tier: TierLetter): string {
  switch (tier) {
    case "S":
      return "text-amber-400";
    case "A":
      return "text-emerald-400";
    case "B":
      return "text-blue-400";
    case "C":
      return "text-zinc-300";
    case "D":
      return "text-orange-400";
    case "F":
      return "text-red-400";
  }
}

export function tierBgColor(tier: TierLetter): string {
  switch (tier) {
    case "S":
      return "bg-amber-400/10 border-amber-400/30";
    case "A":
      return "bg-emerald-400/10 border-emerald-400/30";
    case "B":
      return "bg-blue-400/10 border-blue-400/30";
    case "C":
      return "bg-zinc-400/10 border-zinc-400/30";
    case "D":
      return "bg-orange-400/10 border-orange-400/30";
    case "F":
      return "bg-red-400/10 border-red-400/30";
  }
}
