/**
 * Syncs game data from the Spire Codex API into Supabase.
 * Run via: npx tsx src/game-data/sync-codex.ts
 *
 * Rate limit: 60 req/min on Spire Codex API.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@sts2/shared/types/database.types";
import type {
  CardInsert,
  RelicInsert,
  PotionInsert,
  MonsterInsert,
  KeywordInsert,
} from "@/lib/supabase/helpers";

const CODEX_BASE = "https://spire-codex.com/api";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient<Database>(supabaseUrl, supabaseKey);

async function fetchCodex<T>(path: string): Promise<T> {
  const url = `${CODEX_BASE}${path}`;
  console.log(`  Fetching ${url}...`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Codex API ${res.status}: ${url}`);
  }
  return res.json();
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface CodexCard {
  id: string;
  name: string;
  description: string;
  description_raw?: string;
  cost: number | null;
  star_cost: number | null;
  type: string;
  type_key?: string;
  rarity: string;
  rarity_key?: string;
  color: string;
  target?: string;
  damage: number | null;
  block: number | null;
  hit_count: number | null;
  keywords: string[] | null;
  keywords_key?: string[] | null;
  tags: string[] | null;
  image_url?: string;
}

interface CodexRelic {
  id: string;
  name: string;
  description: string;
  rarity?: string;
  pool?: string;
  image_url?: string;
}

interface CodexPotion {
  id: string;
  name: string;
  description: string;
  rarity?: string;
  pool?: string;
  image_url?: string;
}

interface CodexMonster {
  id: string;
  name: string;
  type: string;
  min_hp: number;
  max_hp: number;
  moves?: unknown[];
  image_url?: string;
}

interface CodexKeyword {
  id: string;
  name: string;
  description: string;
}

async function syncCards(version: string) {
  console.log("Syncing cards...");
  const cards = await fetchCodex<CodexCard[]>("/cards");

  const rows: CardInsert[] = cards.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    description_raw: c.description_raw ?? null,
    cost: c.cost,
    star_cost: c.star_cost,
    type: c.type,
    rarity: c.rarity,
    color: c.color,
    target: c.target ?? null,
    damage: c.damage,
    block: c.block,
    hit_count: c.hit_count,
    keywords: c.keywords,
    tags: c.tags,
    image_url: c.image_url ?? null,
    game_version: version,
  }));

  const { error } = await supabase.from("cards").upsert(rows);
  if (error) throw error;
  console.log(`  ✓ ${rows.length} cards synced`);
}

async function syncRelics(version: string) {
  console.log("Syncing relics...");
  const relics = await fetchCodex<CodexRelic[]>("/relics");

  const rows: RelicInsert[] = relics.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    rarity: r.rarity ?? null,
    pool: r.pool ?? null,
    image_url: r.image_url ?? null,
    game_version: version,
  }));

  const { error } = await supabase.from("relics").upsert(rows);
  if (error) throw error;
  console.log(`  ✓ ${rows.length} relics synced`);
}

async function syncPotions(version: string) {
  console.log("Syncing potions...");
  const potions = await fetchCodex<CodexPotion[]>("/potions");

  const rows: PotionInsert[] = potions.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    rarity: p.rarity ?? null,
    pool: p.pool ?? null,
    image_url: p.image_url ?? null,
    game_version: version,
  }));

  const { error } = await supabase.from("potions").upsert(rows);
  if (error) throw error;
  console.log(`  ✓ ${rows.length} potions synced`);
}

async function syncMonsters(version: string) {
  console.log("Syncing monsters...");
  const monsters = await fetchCodex<CodexMonster[]>("/monsters");

  const rows: MonsterInsert[] = monsters.map((m) => ({
    id: m.id,
    name: m.name,
    type: m.type,
    min_hp: m.min_hp,
    max_hp: m.max_hp,
    moves: m.moves ? JSON.parse(JSON.stringify(m.moves)) : null,
    image_url: m.image_url ?? null,
    game_version: version,
  }));

  const { error } = await supabase.from("monsters").upsert(rows);
  if (error) throw error;
  console.log(`  ✓ ${rows.length} monsters synced`);
}

async function syncKeywords(version: string) {
  console.log("Syncing keywords...");
  const keywords = await fetchCodex<CodexKeyword[]>("/keywords");

  const rows: KeywordInsert[] = keywords.map((k) => ({
    id: k.id,
    name: k.name,
    description: k.description,
    game_version: version,
  }));

  const { error } = await supabase.from("keywords").upsert(rows);
  if (error) throw error;
  console.log(`  ✓ ${rows.length} keywords synced`);
}

async function main() {
  const version = process.argv[2] ?? "unknown";
  console.log(`\nSyncing Spire Codex data (version: ${version})...\n`);

  // Ensure version exists
  await supabase
    .from("game_versions")
    .upsert({ version, synced_at: new Date().toISOString() });

  await syncCards(version);
  await delay(1200); // respect rate limit
  await syncRelics(version);
  await delay(1200);
  await syncPotions(version);
  await delay(1200);
  await syncMonsters(version);
  await delay(1200);
  await syncKeywords(version);

  console.log("\n✓ All game data synced successfully!\n");
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
