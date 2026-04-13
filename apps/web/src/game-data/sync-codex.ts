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
} from "@sts2/shared/supabase/helpers";

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
  upgrade?: Record<string, string | number> | null;
  upgrade_description?: string | null;
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

interface CodexEvent {
  id: string;
  name: string;
  type: string;
  act: string | null;
  description: string | null;
  preconditions: unknown[] | null;
  options: { id: string; title: string; description: string }[] | null;
  pages: { id: string; description: string; options: { id: string; title: string; description: string }[] | null }[] | null;
  epithet: string | null;
  dialogue: Record<string, { order: string; speaker: string; text: string }[]> | null;
  image_url: string | null;
  relics: string[] | null;
}

interface CodexEnchantment {
  id: string;
  name: string;
  description: string;
  description_raw: string | null;
  extra_card_text: string | null;
  card_type: string | null;
  applicable_to: string | null;
  is_stackable: boolean;
  image_url: string | null;
}

interface CodexPower {
  id: string;
  name: string;
  description: string;
  description_raw: string | null;
  type: string;
  stack_type: string | null;
  allow_negative: boolean | null;
  image_url: string | null;
}

interface CodexEncounter {
  id: string;
  name: string;
  room_type: string;
  is_weak: boolean;
  act: string | null;
  tags: string[] | null;
  monsters: { id: string; name: string }[] | null;
  loss_text: string | null;
}

interface CodexOrb {
  id: string;
  name: string;
  description: string;
  description_raw: string | null;
  image_url: string | null;
}

interface CodexAffliction {
  id: string;
  name: string;
  description: string;
  extra_card_text: string | null;
  is_stackable: boolean;
}

interface CodexCharacter {
  id: string;
  name: string;
  description: string | null;
  starting_hp: number;
  starting_gold: number;
  max_energy: number;
  orb_slots: number | null;
  starting_deck: string[];
  starting_relics: string[];
  unlocks_after: string | null;
  gender: string | null;
  color: string | null;
  image_url: string | null;
}

async function syncCards(version: string) {
  console.log("Syncing cards...");
  const cards = await fetchCodex<CodexCard[]>("/cards");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- upgrade columns may not be in generated types yet
  const rows: any[] = cards.map((c) => ({
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
    upgrade: c.upgrade ?? null,
    upgrade_description: c.upgrade_description ?? null,
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

async function syncEvents(version: string) {
  console.log("Syncing events...");
  const events = await fetchCodex<CodexEvent[]>("/events");

  const rows = events.map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    act: e.act ?? null,
    description: e.description ?? null,
    preconditions: e.preconditions ? JSON.parse(JSON.stringify(e.preconditions)) : null,
    options: e.options ? JSON.parse(JSON.stringify(e.options)) : null,
    pages: e.pages ? JSON.parse(JSON.stringify(e.pages)) : null,
    epithet: e.epithet ?? null,
    dialogue: e.dialogue ? JSON.parse(JSON.stringify(e.dialogue)) : null,
    image_url: e.image_url ?? null,
    relics: e.relics ?? null,
    game_version: version,
  }));

  const { error } = await supabase.from("events").upsert(rows);
  if (error) throw error;
  console.log(`  ✓ ${rows.length} events synced`);
}

async function syncEnchantments(version: string) {
  console.log("Syncing enchantments...");
  const enchantments = await fetchCodex<CodexEnchantment[]>("/enchantments");

  const rows = enchantments.map((e) => ({
    id: e.id,
    name: e.name,
    description: e.description,
    description_raw: e.description_raw ?? null,
    extra_card_text: e.extra_card_text ?? null,
    card_type: e.card_type ?? null,
    applicable_to: e.applicable_to ?? null,
    is_stackable: e.is_stackable,
    image_url: e.image_url ?? null,
    game_version: version,
  }));

  const { error } = await supabase.from("enchantments").upsert(rows);
  if (error) throw error;
  console.log(`  ✓ ${rows.length} enchantments synced`);
}

async function syncPowers(version: string) {
  console.log("Syncing powers...");
  const powers = await fetchCodex<CodexPower[]>("/powers");

  const rows = powers.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    description_raw: p.description_raw ?? null,
    type: p.type,
    stack_type: p.stack_type ?? null,
    allow_negative: p.allow_negative ?? null,
    image_url: p.image_url ?? null,
    game_version: version,
  }));

  const { error } = await supabase.from("powers").upsert(rows);
  if (error) throw error;
  console.log(`  ✓ ${rows.length} powers synced`);
}

async function syncEncounters(version: string) {
  console.log("Syncing encounters...");
  const encounters = await fetchCodex<CodexEncounter[]>("/encounters");

  const rows = encounters.map((e) => ({
    id: e.id,
    name: e.name,
    room_type: e.room_type,
    is_weak: e.is_weak,
    act: e.act ?? null,
    tags: e.tags ?? null,
    monsters: e.monsters ? JSON.parse(JSON.stringify(e.monsters)) : null,
    loss_text: e.loss_text ?? null,
    game_version: version,
  }));

  const { error } = await supabase.from("encounters").upsert(rows);
  if (error) throw error;
  console.log(`  ✓ ${rows.length} encounters synced`);
}

async function syncOrbs(version: string) {
  console.log("Syncing orbs...");
  const orbs = await fetchCodex<CodexOrb[]>("/orbs");

  const rows = orbs.map((o) => ({
    id: o.id,
    name: o.name,
    description: o.description,
    description_raw: o.description_raw ?? null,
    image_url: o.image_url ?? null,
    game_version: version,
  }));

  const { error } = await supabase.from("orbs").upsert(rows);
  if (error) throw error;
  console.log(`  ✓ ${rows.length} orbs synced`);
}

async function syncAfflictions(version: string) {
  console.log("Syncing afflictions...");
  const afflictions = await fetchCodex<CodexAffliction[]>("/afflictions");

  const rows = afflictions.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    extra_card_text: a.extra_card_text ?? null,
    is_stackable: a.is_stackable,
    game_version: version,
  }));

  const { error } = await supabase.from("afflictions").upsert(rows);
  if (error) throw error;
  console.log(`  ✓ ${rows.length} afflictions synced`);
}

async function syncCharacters(version: string) {
  console.log("Syncing characters...");
  const characters = await fetchCodex<CodexCharacter[]>("/characters");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- new columns may not be in generated types yet
  const rows: any[] = characters.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description ?? null,
    starting_hp: c.starting_hp,
    starting_gold: c.starting_gold,
    starting_energy: c.max_energy,
    orb_slots: c.orb_slots ?? null,
    starting_deck: c.starting_deck,
    starting_relics: c.starting_relics,
    unlocks_after: c.unlocks_after ?? null,
    gender: c.gender ?? null,
    color: c.color ?? null,
    image_url: c.image_url ?? null,
    game_version: version,
  }));

  const { error } = await supabase.from("characters").upsert(rows);
  if (error) throw error;
  console.log(`  ✓ ${rows.length} characters synced`);
}

async function main() {
  const version = process.argv[2] ?? "unknown";
  console.log(`\nSyncing Spire Codex data (version: ${version})...\n`);

  // Ensure version exists
  await supabase
    .from("game_versions")
    .upsert({ version, synced_at: new Date().toISOString() });

  // Existing syncs
  await syncCards(version);
  await delay(1200);
  await syncRelics(version);
  await delay(1200);
  await syncPotions(version);
  await delay(1200);
  await syncMonsters(version);
  await delay(1200);
  await syncKeywords(version);
  await delay(1200);

  // New syncs
  await syncEvents(version);
  await delay(1200);
  await syncEnchantments(version);
  await delay(1200);
  await syncPowers(version);
  await delay(1200);
  await syncEncounters(version);
  await delay(1200);
  await syncOrbs(version);
  await delay(1200);
  await syncAfflictions(version);
  await delay(1200);
  await syncCharacters(version);

  console.log("\n✓ All game data synced successfully!\n");
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
