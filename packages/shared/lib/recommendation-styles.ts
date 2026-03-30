export const RECOMMENDATION_BORDER: Record<string, string> = {
  strong_pick: "border-amber-500/60",
  good_pick: "border-emerald-500/40",
  situational: "border-blue-500/40",
  skip: "border-zinc-700/40",
};

export const RECOMMENDATION_CHIP: Record<string, string> = {
  strong_pick: "bg-amber-500/15 text-amber-400",
  good_pick: "bg-emerald-400/10 text-emerald-400",
  situational: "bg-blue-400/10 text-blue-400",
  skip: "bg-zinc-700/50 text-zinc-500",
};

export const RECOMMENDATION_LABEL: Record<string, string> = {
  strong_pick: "Strong Pick",
  good_pick: "Good Pick",
  situational: "Situational",
  skip: "Skip",
};

// Glow effects for highlighted recommendations
export const RECOMMENDATION_GLOW: Record<string, string> = {
  strong_pick: "glow-gold-strong animate-pulse-glow",
  good_pick: "shadow-emerald-500/20 shadow-lg",
  situational: "",
  skip: "",
};
