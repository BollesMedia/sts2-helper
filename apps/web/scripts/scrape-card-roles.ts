#!/usr/bin/env tsx
/**
 * Scrapes the STS2 wiki cards data module to produce card-roles.json.
 * Re-run on demand when wiki data shifts. Not part of CI.
 *
 * Usage: pnpm tsx apps/web/scripts/scrape-card-roles.ts
 *
 * Writes: packages/shared/evaluation/card-reward/card-roles.json
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const WIKI_CARDS_URL =
  "https://slaythespire.wiki.gg/wiki/Module:Cards/StS2_data?action=raw";

interface CardRoleEntry {
  name: string;
  character: string;
  role: "damage" | "block" | "scaling" | "draw" | "removal" | "utility" | "power_payoff" | "unknown";
  keystoneFor: string | null;
  fitsArchetypes: string[];
  maxCopies: number;
}

/**
 * Keystone classifications. These are STS2-specific and hand-curated from
 * in-game knowledge — the wiki doesn't tag keystones directly. Extend when
 * new archetype anchors are identified.
 */
const KEYSTONES: Record<string, { archetype: string; maxCopies?: number }> = {
  inflame: { archetype: "strength", maxCopies: 1 },
  "demon form": { archetype: "strength", maxCopies: 1 },
  corruption: { archetype: "exhaust", maxCopies: 1 },
  "dark embrace": { archetype: "exhaust", maxCopies: 1 },
  "feel no pain": { archetype: "exhaust", maxCopies: 1 },
  barricade: { archetype: "block", maxCopies: 1 },
  envenom: { archetype: "poison", maxCopies: 1 },
  "noxious fumes": { archetype: "poison", maxCopies: 1 },
  "infinite blades": { archetype: "shiv", maxCopies: 1 },
  "creative ai": { archetype: "focus", maxCopies: 1 },
  "biased cognition": { archetype: "focus", maxCopies: 1 },
  "reaper form": { archetype: "reaper", maxCopies: 1 },
  "seven stars": { archetype: "star", maxCopies: 1 },
};

/** Cards whose description implies their role unambiguously. */
function classifyRole(
  name: string,
  description: string,
  type: string,
): CardRoleEntry["role"] {
  const lc = (name + " " + description).toLowerCase();
  if (KEYSTONES[name.toLowerCase()]) return "scaling";
  if (/gain \d+ strength|gain \d+ dexterity|at the start of each turn, gain \d+/.test(lc)) return "scaling";
  if (/deal \d+ damage times|damage equal to|\+\d+ damage per/.test(lc)) return "power_payoff";
  if (/exhaust a card|remove a card/.test(lc)) return "removal";
  if (/draw \d+ card|add \d+ card|skim/.test(lc)) return "draw";
  if (type.toLowerCase() === "attack") return "damage";
  if (type.toLowerCase() === "skill" && /block/.test(lc)) return "block";
  return "utility";
}

function fitsArchetypes(name: string, description: string): string[] {
  const lc = (name + " " + description).toLowerCase();
  const fits: string[] = [];
  const pairs: [string, string[]][] = [
    ["strength", ["strength", "strength-dependent"]],
    ["exhaust", ["exhaust"]],
    ["block", ["block"]],
    ["poison", ["poison"]],
    ["shiv", ["shiv"]],
    ["frost", ["frost", "channel"]],
    ["lightning", ["lightning"]],
    ["focus", ["focus", "orb"]],
  ];
  for (const [archetype, signals] of pairs) {
    if (signals.some((s) => lc.includes(s))) fits.push(archetype);
  }
  return fits;
}

async function main() {
  const res = await fetch(WIKI_CARDS_URL);
  if (!res.ok) {
    throw new Error(`wiki fetch failed: ${res.status}`);
  }
  const raw = await res.text();

  // Wiki module is Lua. Extract card entries via a permissive regex.
  // Each entry looks like:
  //   ["CardID"] = { name = "Foo", type = "Attack", character = "Ironclad",
  //                  description = "Deal X damage." }
  const entries: CardRoleEntry[] = [];
  const re =
    /\[\s*"([^"]+)"\s*\]\s*=\s*\{[^}]*?name\s*=\s*"([^"]+)"[^}]*?type\s*=\s*"([^"]+)"[^}]*?character\s*=\s*"([^"]*)"[^}]*?description\s*=\s*"((?:\\"|[^"])*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const [, id, name, type, character, descriptionRaw] = m;
    const description = descriptionRaw.replace(/\\"/g, '"').replace(/\\n/g, " ");
    const nameLower = name.toLowerCase();
    const keystone = KEYSTONES[nameLower];
    entries.push({
      name,
      character: (character || "unknown").toLowerCase(),
      role: classifyRole(name, description, type),
      keystoneFor: keystone?.archetype ?? null,
      fitsArchetypes: fitsArchetypes(name, description),
      maxCopies: keystone?.maxCopies ?? 2,
    });
  }

  if (entries.length < 15) {
    // Fallback path: wiki URL 404'd, returned non-Lua, or the regex parsed
    // nothing. Log the first 500 chars for diagnosis and hand-seed a minimal
    // set of Ironclad anchors so downstream tagging work isn't blocked.
    console.warn(
      `Regex parsed only ${entries.length} entries. First 500 chars of response:`,
    );
    console.warn(raw.slice(0, 500));
    console.warn("Falling back to hand-seeded Ironclad anchors.");

    const seed: Array<Omit<CardRoleEntry, "keystoneFor" | "maxCopies"> & {
      keystoneFor?: string | null;
      maxCopies?: number;
    }> = [
      // KEYSTONES from the top of the file
      { name: "Inflame", character: "ironclad", role: "scaling", fitsArchetypes: ["strength"], keystoneFor: "strength", maxCopies: 1 },
      { name: "Demon Form", character: "ironclad", role: "scaling", fitsArchetypes: ["strength"], keystoneFor: "strength", maxCopies: 1 },
      { name: "Corruption", character: "ironclad", role: "scaling", fitsArchetypes: ["exhaust"], keystoneFor: "exhaust", maxCopies: 1 },
      { name: "Dark Embrace", character: "ironclad", role: "scaling", fitsArchetypes: ["exhaust"], keystoneFor: "exhaust", maxCopies: 1 },
      { name: "Feel No Pain", character: "ironclad", role: "scaling", fitsArchetypes: ["exhaust", "block"], keystoneFor: "exhaust", maxCopies: 1 },
      { name: "Barricade", character: "ironclad", role: "scaling", fitsArchetypes: ["block"], keystoneFor: "block", maxCopies: 1 },
      // Common Ironclad anchors
      { name: "Strike", character: "ironclad", role: "damage", fitsArchetypes: [] },
      { name: "Defend", character: "ironclad", role: "block", fitsArchetypes: ["block"] },
      { name: "Bash", character: "ironclad", role: "damage", fitsArchetypes: [] },
      { name: "Heavy Blade", character: "ironclad", role: "damage", fitsArchetypes: ["strength"] },
      { name: "Pommel Strike", character: "ironclad", role: "damage", fitsArchetypes: [] },
      { name: "Iron Wave", character: "ironclad", role: "damage", fitsArchetypes: ["block"] },
      { name: "Anger", character: "ironclad", role: "damage", fitsArchetypes: [] },
      { name: "Cleave", character: "ironclad", role: "damage", fitsArchetypes: [] },
      { name: "Body Slam", character: "ironclad", role: "damage", fitsArchetypes: ["block"] },
      { name: "Clothesline", character: "ironclad", role: "damage", fitsArchetypes: [] },
      { name: "Flex", character: "ironclad", role: "scaling", fitsArchetypes: ["strength"] },
      { name: "Shrug It Off", character: "ironclad", role: "block", fitsArchetypes: ["block"] },
      { name: "True Grit", character: "ironclad", role: "block", fitsArchetypes: ["block"] },
      { name: "Warcry", character: "ironclad", role: "draw", fitsArchetypes: [] },
    ];

    entries.length = 0;
    for (const s of seed) {
      entries.push({
        name: s.name,
        character: s.character,
        role: s.role,
        keystoneFor: s.keystoneFor ?? null,
        fitsArchetypes: s.fitsArchetypes,
        maxCopies: s.maxCopies ?? 2,
      });
    }
  }

  const byId: Record<string, CardRoleEntry> = {};
  for (const e of entries) byId[e.name.toLowerCase()] = e;

  const outPath = "packages/shared/evaluation/card-reward/card-roles.json";
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ cards: byId }, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(byId).length} cards to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
