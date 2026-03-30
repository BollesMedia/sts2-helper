# STS2 Replay — Design Context for v0

## What This App Is

STS2 Replay is a companion app for Slay the Spire 2 — a roguelike deckbuilder. It runs as a native desktop window (Tauri + React) alongside the game, providing real-time AI-powered card evaluations, shop advice, map pathing, and strategy coaching. Think of it as a coach watching over your shoulder.

The app polls the game's local API every 0.5-5 seconds and automatically switches views based on game state. Users glance at it between turns — it must be scannable at a glance, never require scrolling, and communicate recommendations instantly.

## Design Constraints

- **Window size:** Modest secondary window (~400-600px wide, ~600-800px tall). Users resize freely.
- **No scrolling:** Everything must fit in the viewport. Use layout (sidebars, grids, expand/collapse) not vertical stacking.
- **Glanceable:** Users are focused on the game. Recommendations must be visually obvious in <1 second — color, badges, and hierarchy do the work, not text.
- **Dark theme only:** The game is dark; the companion must not be visually jarring alongside it.
- **Information density:** Show what matters, hide details behind interaction (click-to-expand, hover). Every pixel earns its place.

## Tech Stack

- React 19 (functional components + hooks)
- TailwindCSS v4
- Vite (bundled in Tauri)
- Shared component library in `packages/shared/`
- `cn()` utility from clsx + tailwind-merge

## Current Color System

### Base
- Background: `#0a0a0a` (near black)
- Text: `zinc-100` (primary), `zinc-300` (secondary), `zinc-500` (muted), `zinc-600` (disabled)
- Borders: `zinc-800` (default), `zinc-700` (interactive)
- Cards/surfaces: `bg-zinc-900/50` with `border border-zinc-800`

### Semantic — Recommendation Tiers
These colors communicate evaluation quality at a glance:
- **Strong Pick (take this):** `emerald-500/400` — green border, green text
- **Good Pick:** `blue-500/400` — blue border, blue text
- **Situational:** `amber-500/400` — amber border, amber text
- **Skip:** `zinc-700/400` — muted, barely visible

### Semantic — Card Tiers (S through F)
- S: `amber-400` (gold/elite feel)
- A: `emerald-400` (strong green)
- B: `blue-400`
- C: `zinc-300` (neutral)
- D: `orange-400`
- F: `red-400`

### Card Type Colors
- Attack: `red-400`
- Skill: `blue-400`
- Power: `amber-400`
- Relic: `purple-400`
- Potion: `emerald-400`
- Service: `cyan-400`

### Map Node Colors (SVG fills)
- Monster: `#ef4444` (red)
- Elite: `#f59e0b` (amber)
- Boss: `#dc2626` (dark red)
- RestSite: `#34d399` (emerald)
- Shop: `#60a5fa` (blue)
- Treasure: `#fbbf24` (gold)
- Unknown: `#a1a1aa` (gray)

## App Structure

```
App
├─ LoginScreen (email/password, Discord OAuth)
├─ SetupWizard (mod installation — first run only)
└─ AuthenticatedApp
   ├─ ConnectionBanner (shown when game not detected)
   └─ Main Layout
      ├─ AppHeader (status bar: game state, HP, gold, floor, act)
      ├─ GameStateView (auto-switches based on game state)
      │  ├─ CombatView (enemies, hand, status effects, boss briefing)
      │  ├─ CardPickView (3-column card evaluation grid)
      │  ├─ ShopView (2-column expandable item list)
      │  ├─ CardRemovalView (4-column card grid with removal recommendation)
      │  ├─ MapView (SVG map + evaluation sidebar)
      │  ├─ RelicSelectView (3-column relic choice grid)
      │  ├─ EventView (3-column event option grid)
      │  ├─ RestSiteView (2-column rest option grid)
      │  ├─ CombatRewardsView (reward list)
      │  └─ MenuView (run outcome confirmation)
      └─ Footer (dev tools: clear cache, re-evaluate)
```

## Screen-by-Screen Breakdown

### 1. Card Reward (most common decision screen)
**Current:** 3-column grid of card evaluation cards
**Key elements per card:**
- Tier badge (S-F, colored circle)
- Card name
- Card type + rarity + energy cost
- Card description
- Recommendation chip ("Strong Pick", "Skip", etc.)
- Brief reasoning (max 12 words)
- "PICK THIS" banner on recommended card (emerald, positioned above card)

**Above the grid:**
- `pick_summary`: one-line recommendation ("Pick Corruption — starts exhaust engine")
- Skip recommendation (amber) when all cards should be skipped

**Design goal:** The recommended card must be instantly obvious. A user glancing for 1 second should know which card to pick without reading any text.

### 2. Shop (complex, many items)
**Current:** 2-column layout. Left = cards, Right = relics/potions/services. Each item is a compact expandable row.
**Compact row:** `[Tier] Name [recommendation chip] Type Cost`
**Expanded:** Shows description + reasoning on click
**Top:** Spending plan one-liner from the AI

**Design goal:** Dense but scannable. 12+ items must fit without scrolling. Expand for details.

### 3. Map (side-by-side layout)
**Current:** Left = SVG map visualization, Right = path evaluation sidebar
**Map:** Nodes with color-coded types, edges showing paths, highlighted best path in emerald
**Sidebar:** Stacked path option cards with tier, node type icon, reasoning
**Top of sidebar:** Overall advice one-liner

**Design goal:** Map is the visual anchor. Sidebar provides the "what to do" at a glance.

### 4. Boss Relic Select (3 options, must pick one)
**Current:** 3-column grid similar to card reward
**Each relic:** Tier badge, name, description, reasoning, "PICK THIS" banner on top choice
**Top:** `pick_summary` one-liner

### 5. Event (2-4 options, must pick one)
**Current:** 3-column grid of event options
**Each option:** Tier badge, option title, description, reasoning

### 6. Rest Site (2-3 options)
**Current:** 2-column grid
**Each option:** Icon (emoji), option name, reasoning
**Context bar above:** Current HP with HP bar

### 7. Card Removal (from shop)
**Current:** 4-column grid of all removable cards
**Recommendation:** One card highlighted in emerald with "REMOVE" badge
**Top:** "Remove [card] — [reason]" one-liner

### 8. Combat (passive — no decisions to make)
**Current:** 2-column grid: player stats (HP, block, energy, potions) + enemy info (HP, intents, status)
**Below:** Hand display, boss briefing (if boss fight)

**Design goal:** Information display, not decision support. Keep it clean and dense.

### 9. Connection Banner (waiting for game)
**Current:** Centered status message with connection indicator
**Shows:** "Waiting for Slay the Spire 2...", user email, sign out button

### 10. Menu (run ended)
**Current:** Centered outcome confirmation with victory/defeat buttons
**Optional:** Notes textarea for the player to record what happened

### 11. Login Screen
**Current:** Centered form with Discord OAuth button + email/password form
**Branding:** "STS2 Replay" title

### 12. Setup Wizard (first run)
**Current:** Centered card with game detection status, required mod list with install/update status, progress bar during installation

## Shared Components

### TierBadge
Circular badge showing S/A/B/C/D/F. Three sizes: sm (20px), md (28px), lg (36px). Color-coded per tier.

### HpBar
Horizontal HP bar with current/max text. Color transitions: green (>60%), amber (30-60%), red (<30%). Two sizes.

### ConfidenceIndicator
Thin progress bar with confidence percentage. Color matches tier conventions.

### EvalError
Error message box with optional retry button. Zinc styling with subtle border.

### CardSkeleton
Animated pulse placeholder for loading states.

## Design Principles

1. **Recommendation first:** The #1 thing the user needs is "what should I do?" — make that instantly visible through color, position, and badges. Details (why, alternatives) are secondary.

2. **Color carries meaning:** Users learn the color system quickly. Green = take it, amber = think about it, muted = skip. Don't use color decoratively.

3. **Compact > spacious:** This is a utility, not a marketing page. Tight spacing, small text, dense information. Every pixel should serve a purpose.

4. **No scrolling, ever:** If content doesn't fit, the layout is wrong. Use grids, sidebars, expand/collapse, and smaller text before resorting to scroll.

5. **Dark and unobtrusive:** The game has the user's attention. This window is peripheral vision. High contrast for key info (recommendation), low contrast for everything else.

6. **Consistent patterns:** Cards, events, relics, rest options all follow the same visual pattern — tier badge + name + recommendation + reasoning. Learn one, know them all.

## What Needs Design Attention

- **Overall visual polish:** The current UI is functional but utilitarian. Needs a cohesive visual language.
- **Card reward cards:** The most-seen component. The "PICK THIS" banner and tier badge need to pop without being garish.
- **Shop density:** 12+ items in a compact space. The expandable row pattern works but could look better.
- **Map layout:** SVG map + sidebar needs to feel integrated, not like two separate panels.
- **AppHeader:** Currently just a row of text. Could be more polished with the game state info.
- **Transitions:** Currently no animation between game state views. Could benefit from subtle crossfade.
- **Typography hierarchy:** Currently uses raw Tailwind sizes. A consistent scale would help.
- **Empty/loading states:** Skeleton loading exists but could be more polished.
- **The "glance factor":** When a user looks at the window for 1 second, can they instantly see what to do? This is the core UX challenge.
