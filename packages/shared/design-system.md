# STS2 Replay Design System

> "Inspired by, not copying" — dark fantasy mood from STS2 with a clean, utilitarian companion-app identity.

## Philosophy

The game is hand-drawn whimsy. The app is a **clean digital utility with a touch of that same mood**. Think: premium strategy tool that belongs in the STS2 ecosystem without pretending to be the game.

## Color Palette

### Backgrounds & Surfaces

Near-black base with a subtle cool blue-violet undertone. Reads as "fantasy dungeon" rather than "generic dark mode."

| Token | Hex | Usage |
|-------|-----|-------|
| `spire-base` | `#0B0D10` | App background, darkest layer |
| `spire-surface` | `#12141A` | Cards, panels, primary surface |
| `spire-elevated` | `#1A1D25` | Hover states, active surfaces |
| `spire-overlay` | `#22252E` | Tooltips, dropdowns |
| `spire-muted` | `#2A2D36` | Disabled surfaces, dividers |

### Borders

| Token | Hex | Usage |
|-------|-----|-------|
| `spire-border` | `#2A2D36` | Standard borders |
| `spire-border-subtle` | `#1F2229` | Faint dividers |
| `spire-border-emphasis` | `#3D4150` | Focused/active borders |

### Text

| Token | Hex | Usage |
|-------|-----|-------|
| `spire-text` | `#E8E9ED` | Primary headings |
| `spire-text-secondary` | `#A1A5B0` | Body, descriptions |
| `spire-text-tertiary` | `#6B7084` | Labels, metadata |
| `spire-text-muted` | `#4A4F5E` | Disabled, placeholder |

### Accent Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `spire-gold` | `#D4A843` | Primary accent: picks, recommendations, rare |
| `spire-gold-light` | `#F0D68A` | Gold highlights, S-tier glow |

Standard Tailwind accents for functional color: `emerald-400`, `blue-500`, `red-500`, `amber-500`, `purple-500`.

## Card Type Colors

Since we show cards in lists without STS2's shape-based frames, we use color to differentiate types.

| Type | Color | Hex |
|------|-------|-----|
| Attack | Red | `#EF4444` |
| Skill | Blue | `#3B82F6` |
| Power | Amber | `#F59E0B` |
| Curse | Gray | `#6B7280` |
| Status | Gray | `#6B7280` |

## Card Rarity Colors

Mirrors STS2's banner colors exactly.

| Rarity | Color | Hex |
|--------|-------|-----|
| Basic | Zinc | `#71717A` |
| Common | Zinc | `#A1A1AA` |
| Uncommon | Blue | `#3B82F6` |
| Rare | Gold | `#D4A843` |
| Event | Green | `#22C55E` |

## Tier Badge Colors

| Tier | Text | Glow |
|------|------|------|
| S | Amber-400 | Yes |
| A | Emerald-400 | Yes |
| B | Blue-400 | No |
| C | Zinc-400 | No |
| D | Orange-400 | No |
| F | Red-500 | No |

## Typography

| Role | Font | Weight | Usage |
|------|------|--------|-------|
| Display | Bitter | 600-700 | Card names, section headers, view titles |
| Body | system-ui | 400-500 | Descriptions, evaluations, advice |
| Data | ui-monospace | 500 | Numbers, costs, damage, stats |

### Loading Bitter

Via Google Fonts, loaded in the app root:
```html
<link href="https://fonts.googleapis.com/css2?family=Bitter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

Applied via Tailwind `fontFamily.display` or the CSS class `font-display`.

## Component Patterns

### Cards

- Dark surface background
- Left-side 2px color accent strip (card type or rarity)
- Energy cost badge (top right, blue chip)
- Tier badge + recommendation label in evaluation footer
- Hover: border brightens, subtle transition

### Panels

- `spire-surface` background, `spire-border` border
- `rounded-lg` (8px)
- Section title: uppercase tracking-wide 9-10px

### Badges / Chips

- Pill-shaped or rounded
- Color at 10-15% opacity background + 20-30% opacity border
- Font-medium, small text (9-10px)

### HP Bars

- Red fill on dark track
- Compact, rounded ends
- Numbers in mono font

### "Best Pick" Treatment

- Emerald border + subtle emerald shadow glow
- Inline "Pick This" badge (not absolute positioned)
- Left edge emerald accent

### Status Effects

- Buff: emerald background
- Debuff: red background
- Both: 10% opacity bg, matching border, 10px text

## Intent Colors

| Intent | Color |
|--------|-------|
| Attack | Red `#EF4444` |
| Defend | Blue `#60A5FA` |
| Buff | Orange `#FB923C` |
| Debuff | Purple `#A855F7` |
| Unknown | Zinc `#71717A` |

## Map Node Colors

| Node | Color |
|------|-------|
| Monster | Red `#EF4444` |
| Elite | Amber `#F59E0B` |
| Boss | Dark Red `#DC2626` |
| Rest Site | Emerald `#34D399` |
| Shop | Blue `#60A5FA` |
| Treasure | Purple `#A855F7` |
| Unknown | Zinc `#71717A` |

## Sources

Research based on 16 sources. See GitHub issue #40 for full citations.
