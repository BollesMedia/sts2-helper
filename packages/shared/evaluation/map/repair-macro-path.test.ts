import { describe, it, expect } from "vitest";
import { repairMacroPath } from "./repair-macro-path";
import type { RepairInputs, RepairMapNode } from "./repair-macro-path";
import type { MapCoachOutputRaw } from "../map-coach-schema";

// Simple vertical chain: f1 -> f2 -> f3 (boss)
const simpleNodes: RepairMapNode[] = [
  { col: 1, row: 1, type: "Monster", children: [[1, 2]] },
  { col: 1, row: 2, type: "Elite", children: [[1, 3]] },
  { col: 1, row: 3, type: "Boss", children: [] },
];

// Forked graph: f1 branches to either an elite or a shop, both rejoin at boss.
const forkedNodes: RepairMapNode[] = [
  { col: 1, row: 1, type: "Monster", children: [[1, 2], [2, 2]] },
  { col: 1, row: 2, type: "Elite", children: [[1, 3]] },
  { col: 2, row: 2, type: "Shop", children: [[1, 3]] },
  { col: 1, row: 3, type: "Boss", children: [] },
];

function makeInputs(
  output: MapCoachOutputRaw,
  overrides?: Partial<RepairInputs>,
): RepairInputs {
  return {
    output,
    nodes: simpleNodes,
    nextOptions: [{ col: 1, row: 1, type: "Monster" }],
    boss: { col: 1, row: 3 },
    currentPosition: { col: 0, row: 0 },
    ...overrides,
  };
}

function baseOutput(
  floors: MapCoachOutputRaw["macro_path"]["floors"],
): MapCoachOutputRaw {
  return {
    reasoning: { risk_capacity: "m", act_goal: "g" },
    headline: "h",
    confidence: 0.8,
    macro_path: { floors, summary: "s" },
    key_branches: [],
    teaching_callouts: [],
  };
}

describe("repairMacroPath", () => {
  it("passes valid path through unchanged", () => {
    const output = baseOutput([
      { floor: 1, node_type: "monster", node_id: "1,1" },
      { floor: 2, node_type: "elite", node_id: "1,2" },
      { floor: 3, node_type: "boss", node_id: "1,3" },
    ]);
    const result = repairMacroPath(makeInputs(output));
    expect(result.repaired).toBe(false);
    expect(result.repair_reasons).toEqual([]);
    expect(result.output.macro_path.floors).toEqual(output.macro_path.floors);
  });

  it("synthesizes macro_path from the chosen next_option when empty", () => {
    const output = baseOutput([]);
    const result = repairMacroPath(makeInputs(output));
    expect(result.repaired).toBe(true);
    expect(result.repair_reasons.map((r) => r.kind)).toContain(
      "empty_macro_path",
    );
    expect(result.output.macro_path.floors).toEqual([
      { floor: 1, node_type: "monster", node_id: "1,1" },
      { floor: 2, node_type: "elite", node_id: "1,2" },
      { floor: 3, node_type: "boss", node_id: "1,3" },
    ]);
  });

  it("drops an unknown node_id and walks from the last valid node", () => {
    const output = baseOutput([
      { floor: 1, node_type: "monster", node_id: "1,1" },
      { floor: 2, node_type: "elite", node_id: "9,9" },
      { floor: 3, node_type: "boss", node_id: "1,3" },
    ]);
    const result = repairMacroPath(
      makeInputs(output, {
        nodes: forkedNodes,
        nextOptions: [{ col: 1, row: 1, type: "Monster" }],
      }),
    );
    expect(result.repaired).toBe(true);
    expect(result.repair_reasons.map((r) => r.kind)).toContain(
      "unknown_node_id",
    );
    expect(result.output.macro_path.floors[0].node_id).toBe("1,1");
    expect(
      result.output.macro_path.floors[
        result.output.macro_path.floors.length - 1
      ].node_id,
    ).toBe("1,3");
  });

  it("appends a walk to boss when final floor is missing", () => {
    const output = baseOutput([
      { floor: 1, node_type: "monster", node_id: "1,1" },
      { floor: 2, node_type: "elite", node_id: "1,2" },
    ]);
    const result = repairMacroPath(makeInputs(output));
    expect(result.repaired).toBe(true);
    expect(result.repair_reasons.map((r) => r.kind)).toContain("missing_boss");
    expect(
      result.output.macro_path.floors[
        result.output.macro_path.floors.length - 1
      ].node_id,
    ).toBe("1,3");
  });

  it("stitches through a contiguity gap using the smart walker", () => {
    const output = baseOutput([
      { floor: 1, node_type: "monster", node_id: "1,1" },
      { floor: 3, node_type: "boss", node_id: "1,3" },
    ]);
    const result = repairMacroPath(
      makeInputs(output, {
        nodes: forkedNodes,
        nextOptions: [{ col: 1, row: 1, type: "Monster" }],
      }),
    );
    expect(result.repaired).toBe(true);
    expect(result.repair_reasons.map((r) => r.kind)).toContain(
      "contiguity_gap",
    );
    const ids = result.output.macro_path.floors.map((f) => f.node_id);
    expect(ids).toEqual(["1,1", "1,2", "1,3"]);
  });

  it("swaps first floor when it doesn't match any next_option", () => {
    const output = baseOutput([
      { floor: 0, node_type: "unknown", node_id: "0,0" },
      { floor: 1, node_type: "monster", node_id: "1,1" },
      { floor: 2, node_type: "elite", node_id: "1,2" },
      { floor: 3, node_type: "boss", node_id: "1,3" },
    ]);
    const result = repairMacroPath(
      makeInputs(output, {
        currentPosition: { col: 0, row: 0 },
        nodes: [
          { col: 0, row: 0, type: "Unknown", children: [[1, 1]] },
          ...simpleNodes,
        ],
      }),
    );
    expect(result.repaired).toBe(true);
    expect(result.repair_reasons.map((r) => r.kind)).toContain(
      "starts_at_current_position",
    );
    expect(result.output.macro_path.floors[0].node_id).toBe("1,1");
  });

  it("emits walk_dead_end when the walker cannot reach boss", () => {
    const deadEndNodes: RepairMapNode[] = [
      { col: 1, row: 1, type: "Monster", children: [] },
    ];
    const output = baseOutput([]);
    const result = repairMacroPath(
      makeInputs(output, {
        nodes: deadEndNodes,
        nextOptions: [{ col: 1, row: 1, type: "Monster" }],
        boss: { col: 9, row: 9 },
      }),
    );
    expect(result.repair_reasons.map((r) => r.kind)).toContain(
      "empty_macro_path",
    );
    expect(result.repair_reasons.map((r) => r.kind)).toContain("walk_dead_end");
  });
});
