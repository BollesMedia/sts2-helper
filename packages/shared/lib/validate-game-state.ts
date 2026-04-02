/**
 * Lightweight structural validation for game state responses from the mod API.
 * Validates the v0.3.2 response shape where player is a top-level field.
 * Reports errors via the fetcher's error reporting.
 */

const MAX_SNAPSHOT_BYTES = 10_000;

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
      return { _truncated: true, ...base };
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
    return `array(${value.length}) [${JSON.stringify(describeShape(value[0], depth - 1))}]`;
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

function hasObj(data: Obj, key: string): boolean {
  return data[key] != null && typeof data[key] === "object" && !Array.isArray(data[key]);
}

function hasArr(data: Obj, parentKey: string, childKey: string): boolean {
  const parent = data[parentKey];
  if (!parent || typeof parent !== "object") return false;
  return Array.isArray((parent as Obj)[childKey]);
}

/**
 * Validate that a game state response has the expected shape.
 * Designed for v0.3.2 where player is top-level.
 * Tolerates transitional states (e.g., combat state with message instead of battle).
 */
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

  // v0.3.2: player should be top-level on all non-menu states
  // Transitional states may have message instead — that's OK
  if (stateType !== "menu" && !d.player && !d.message) {
    errors.push("missing top-level player");
  }

  switch (stateType) {
    case "monster":
    case "elite":
    case "boss":
      // battle may be absent during transition (message present instead)
      if (!hasObj(d, "battle") && !d.message) {
        errors.push("missing battle");
      }
      break;

    case "hand_select":
      if (!hasObj(d, "battle")) errors.push("missing battle");
      if (!hasObj(d, "hand_select")) errors.push("missing hand_select");
      break;

    case "card_reward":
      if (!hasObj(d, "card_reward")) errors.push("missing card_reward");
      else if (!hasArr(d, "card_reward", "cards")) errors.push("missing card_reward.cards");
      break;

    case "combat_rewards":
      if (!hasObj(d, "rewards")) errors.push("missing rewards");
      break;

    case "map":
      if (!hasObj(d, "map")) errors.push("missing map");
      else if (!hasArr(d, "map", "nodes")) errors.push("missing map.nodes");
      break;

    case "shop":
      if (!hasObj(d, "shop")) errors.push("missing shop");
      else if (!hasArr(d, "shop", "items")) errors.push("missing shop.items");
      break;

    case "event":
      if (!hasObj(d, "event")) errors.push("missing event");
      else if (!hasArr(d, "event", "options")) errors.push("missing event.options");
      break;

    case "rest_site":
      if (!hasObj(d, "rest_site")) errors.push("missing rest_site");
      else if (!hasArr(d, "rest_site", "options")) errors.push("missing rest_site.options");
      break;

    case "card_select":
      if (!hasObj(d, "card_select")) errors.push("missing card_select");
      else if (!hasArr(d, "card_select", "cards")) errors.push("missing card_select.cards");
      break;

    case "relic_select":
      if (!hasObj(d, "relic_select")) errors.push("missing relic_select");
      break;

    case "treasure":
      if (!hasObj(d, "treasure")) errors.push("missing treasure");
      break;

    case "menu":
      break;

    default:
      // Unknown state_type — pass through
      break;
  }

  return { valid: errors.length === 0, stateType, errors };
}
