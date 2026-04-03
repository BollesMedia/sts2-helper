const NODE_TYPE_ICONS: Record<string, string> = {
  Monster: "⚔️",
  Elite: "💀",
  Boss: "👹",
  RestSite: "🔥",
  Shop: "💰",
  Treasure: "📦",
  Unknown: "❓",
};

/** Single-character labels for SVG nodes (emoji breaks in SVG <text>) */
const NODE_SVG_LABELS: Record<string, string> = {
  Monster: "M",
  Elite: "E",
  Boss: "B",
  RestSite: "R",
  Shop: "$",
  Treasure: "T",
  Unknown: "?",
};

export { NODE_TYPE_ICONS, NODE_SVG_LABELS };
