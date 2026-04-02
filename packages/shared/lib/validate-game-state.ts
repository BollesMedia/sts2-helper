/**
 * Lightweight structural validation for game state responses from the mod API.
 * Checks that critical nested objects exist per state_type, without
 * pulling in a schema library. Reports errors to Sentry + Supabase
 * via reportError when integrated into the fetcher.
 */

const MAX_SNAPSHOT_BYTES = 10_000;

/**
 * Produce a lightweight structural snapshot of JSON-parsed data.
 * Records key names and value types (never actual values) down to `maxDepth` levels.
 * Only inspects the first element of arrays for inner shape.
 * Never throws — returns a fallback on failure.
 */
export function snapshotShape(
  data: unknown,
  maxDepth: number = 3
): Record<string, unknown> {
  try {
    const result = describeShape(data, maxDepth);
    const serialized = JSON.stringify(result);
    if (serialized.length > MAX_SNAPSHOT_BYTES) {
      const shallow = describeShape(data, 1);
      const base = typeof shallow === "object" && shallow !== null ? shallow as Record<string, unknown> : {};
      return { _truncated: true, _note: `snapshot exceeded ${MAX_SNAPSHOT_BYTES} bytes`, ...base };
    }
    return typeof result === "object" && result !== null ? result as Record<string, unknown> : { _value: result };
  } catch {
    return { error: "snapshot_failed" };
  }
}

function describeShape(value: unknown, depth: number): unknown {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return t;

  if (Array.isArray(value)) {
    if (value.length === 0) return "array(0)";
    if (depth <= 0) return `array(${value.length})`;
    const firstShape = describeShape(value[0], depth - 1);
    return `array(${value.length}) [${JSON.stringify(firstShape)}]`;
  }

  if (t === "object") {
    if (depth <= 0) return "object";
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      result[key] = describeShape(obj[key], depth - 1);
    }
    return result;
  }

  return t;
}

interface ValidationResult {
  valid: boolean;
  stateType: string | null;
  errors: string[];
}

type Obj = Record<string, unknown>;

function has(obj: Obj, key: string): boolean {
  return obj[key] != null && typeof obj[key] === "object";
}

function hasArray(obj: Obj, key: string): boolean {
  return Array.isArray(obj[key]);
}

function checkNested(data: Obj, path: string): string | null {
  const parts = path.split(".");
  let current: unknown = data;
  for (const part of parts) {
    if (current == null || typeof current !== "object") {
      return `missing ${path}`;
    }
    current = (current as Obj)[part];
  }
  if (current == null) return `missing ${path}`;
  return null;
}

function checkArray(data: Obj, path: string): string | null {
  const parts = path.split(".");
  let current: unknown = data;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current == null || typeof current !== "object") {
      return `missing ${path}`;
    }
    current = (current as Obj)[parts[i]];
  }
  if (current == null || typeof current !== "object") return `missing ${path}`;
  const last = parts[parts.length - 1];
  if (!Array.isArray((current as Obj)[last])) return `${path} is not an array`;
  return null;
}

export function validateGameStateStructure(data: unknown): ValidationResult {
  if (!data || typeof data !== "object") {
    return { valid: false, stateType: null, errors: ["response is not an object"] };
  }

  const d = data as Obj;
  const stateType = typeof d.state_type === "string" ? d.state_type : null;

  if (!stateType) {
    return { valid: false, stateType: null, errors: ["missing or invalid state_type"] };
  }

  const errors: string[] = [];

  switch (stateType) {
    case "monster":
    case "elite":
    case "boss": {
      const e = checkNested(d, "battle");
      if (e) { errors.push(e); break; }
      // v0.3.2: player at top level; v0.3.0: nested in battle
      if (checkNested(d, "player") && checkNested(d, "battle.player")) {
        errors.push("missing player (neither top-level nor battle.player)");
      }
      break;
    }

    case "hand_select": {
      const e1 = checkNested(d, "battle");
      if (e1) errors.push(e1);
      const e2 = checkNested(d, "hand_select");
      if (e2) errors.push(e2);
      break;
    }

    case "card_reward": {
      const e1 = checkNested(d, "card_reward");
      if (e1) { errors.push(e1); break; }
      const e2 = checkArray(d, "card_reward.cards");
      if (e2) errors.push(e2);
      break;
    }

    case "combat_rewards": {
      const e1 = checkNested(d, "rewards");
      if (e1) { errors.push(e1); break; }
      // v0.3.2: player at top level; v0.3.0: nested
      if (!checkNested(d, "player") === false && checkNested(d, "rewards.player")) {
        // Neither location has player — that's an error
      }
      break;
    }

    case "map": {
      const e1 = checkNested(d, "map");
      if (e1) { errors.push(e1); break; }
      // v0.3.2: player at top level; v0.3.0: nested in map
      const e3 = checkArray(d, "map.nodes");
      if (e3) errors.push(e3);
      break;
    }

    case "shop": {
      const e1 = checkNested(d, "shop");
      if (e1) { errors.push(e1); break; }
      // v0.3.2: player at top level; v0.3.0: nested in shop
      const e3 = checkArray(d, "shop.items");
      if (e3) errors.push(e3);
      break;
    }

    case "event": {
      const e1 = checkNested(d, "event");
      if (e1) { errors.push(e1); break; }
      const e2 = checkArray(d, "event.options");
      if (e2) errors.push(e2);
      break;
    }

    case "rest_site": {
      const e1 = checkNested(d, "rest_site");
      if (e1) { errors.push(e1); break; }
      const e2 = checkArray(d, "rest_site.options");
      if (e2) errors.push(e2);
      break;
    }

    case "card_select": {
      const e1 = checkNested(d, "card_select");
      if (e1) { errors.push(e1); break; }
      const e2 = checkArray(d, "card_select.cards");
      if (e2) errors.push(e2);
      break;
    }

    case "relic_select": {
      const e1 = checkNested(d, "relic_select");
      if (e1) errors.push(e1);
      break;
    }

    case "treasure": {
      const e1 = checkNested(d, "treasure");
      if (e1) errors.push(e1);
      break;
    }

    case "menu":
      // Flat structure, no nested objects to validate
      break;

    default:
      // Unknown state_type — pass through for forward compatibility
      break;
  }

  return { valid: errors.length === 0, stateType, errors };
}
