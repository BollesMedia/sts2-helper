import { describe, it, expect } from "vitest";
import { buildMapContext } from "../build-map-context";
import { createMapState, TEST_NODES, TEST_BOSS } from "../../__tests__/fixtures/map-state";

describe("buildMapContext", () => {
  describe("hasEliteAhead", () => {
    it("detects elite as immediate next option", () => {
      const state = createMapState({
        next_options: [
          { index: 0, col: 0, row: 1, type: "Elite", leads_to: [{ col: 0, row: 2, type: "RestSite" }] },
          { index: 1, col: 2, row: 1, type: "Shop", leads_to: [{ col: 2, row: 2, type: "Monster" }] },
        ],
      });
      expect(buildMapContext(state).hasEliteAhead).toBe(true);
    });

    it("detects elite via children (2-node lookahead)", () => {
      // RestSite at (0,2) has child Elite at (1,3) in the node map
      const state = createMapState({
        current_position: { col: 0, row: 1, type: "Elite" },
        next_options: [
          { index: 0, col: 0, row: 2, type: "RestSite", leads_to: [] },
        ],
        nodes: [
          { col: 0, row: 2, type: "RestSite", children: [[1, 3]] },
          { col: 1, row: 3, type: "Elite", children: [] },
        ],
      });
      expect(buildMapContext(state).hasEliteAhead).toBe(true);
    });

    it("does not false-positive from leads_to (uses children only)", () => {
      // leads_to says Elite but children say Monster — should be false
      const state = createMapState({
        next_options: [
          { index: 0, col: 0, row: 1, type: "Monster", leads_to: [{ col: 0, row: 2, type: "Elite" }] },
        ],
        nodes: [
          { col: 0, row: 1, type: "Monster", children: [[0, 2]] },
          { col: 0, row: 2, type: "Monster", children: [] },
        ],
      });
      expect(buildMapContext(state).hasEliteAhead).toBe(false);
    });

    it("returns false when no elite in next options or children", () => {
      const state = createMapState({
        next_options: [
          { index: 0, col: 0, row: 2, type: "RestSite", leads_to: [{ col: 1, row: 3, type: "Boss" }] },
          { index: 1, col: 2, row: 2, type: "Monster", leads_to: [{ col: 1, row: 3, type: "Boss" }] },
        ],
      });
      expect(buildMapContext(state).hasEliteAhead).toBe(false);
    });

    it("handles next options with empty leads_to", () => {
      const state = createMapState({
        next_options: [
          { index: 0, col: 0, row: 1, type: "Monster", leads_to: [] },
        ],
      });
      expect(buildMapContext(state).hasEliteAhead).toBe(false);
    });
  });

  describe("hasBossAhead", () => {
    it("detects boss as immediate next option", () => {
      const state = createMapState({
        next_options: [
          { index: 0, col: 1, row: 3, type: "Boss", leads_to: [] },
        ],
      });
      expect(buildMapContext(state).hasBossAhead).toBe(true);
    });

    it("detects boss via children (rest site before boss)", () => {
      // RestSite at (0,2) has child Boss at (1,3) in the node map
      const state = createMapState({
        current_position: { col: 0, row: 1, type: "Elite" },
        next_options: [
          { index: 0, col: 0, row: 2, type: "RestSite", leads_to: [] },
        ],
      });
      // Default TEST_NODES has RestSite(0,2)->Boss(1,3)
      expect(buildMapContext(state).hasBossAhead).toBe(true);
    });

    it("does not false-positive from leads_to (uses children only)", () => {
      // leads_to says Boss but children lead to Monster — should be false
      const state = createMapState({
        next_options: [
          { index: 0, col: 0, row: 1, type: "Monster", leads_to: [{ col: 1, row: 3, type: "Boss" }] },
        ],
        nodes: [
          { col: 0, row: 1, type: "Monster", children: [[0, 2]] },
          { col: 0, row: 2, type: "Monster", children: [] },
        ],
      });
      expect(buildMapContext(state).hasBossAhead).toBe(false);
    });

    it("returns false when no boss in next options or children", () => {
      const state = createMapState({
        next_options: [
          { index: 0, col: 0, row: 1, type: "Elite", leads_to: [{ col: 0, row: 2, type: "RestSite" }] },
          { index: 1, col: 2, row: 1, type: "Shop", leads_to: [{ col: 2, row: 2, type: "Monster" }] },
        ],
      });
      expect(buildMapContext(state).hasBossAhead).toBe(false);
    });
  });

  describe("hasRestAhead", () => {
    it("detects rest site reachable from next options", () => {
      const result = buildMapContext(createMapState());
      // Default map: next options are Elite(0,1)->Rest(0,2) and Shop(2,1)->Monster(2,2)
      expect(result.hasRestAhead).toBe(true);
    });

    it("returns false when no rest site is reachable", () => {
      const state = createMapState({
        next_options: [
          { index: 0, col: 2, row: 1, type: "Shop", leads_to: [{ col: 2, row: 2, type: "Monster" }] },
        ],
        nodes: [
          { col: 2, row: 1, type: "Shop", children: [[2, 2]] },
          { col: 2, row: 2, type: "Monster", children: [[1, 3]] },
          { col: 1, row: 3, type: "Boss", children: [] },
        ],
      });
      expect(buildMapContext(state).hasRestAhead).toBe(false);
    });
  });

  describe("hasShopAhead", () => {
    it("detects shop reachable from next options", () => {
      const result = buildMapContext(createMapState());
      expect(result.hasShopAhead).toBe(true);
    });
  });

  describe("floorsToNextBoss", () => {
    it("calculates distance from current position to boss", () => {
      const result = buildMapContext(createMapState());
      // Default: current row 0, boss row 3
      expect(result.floorsToNextBoss).toBe(3);
    });

    it("uses row 0 when current_position is null", () => {
      const state = createMapState({ current_position: null });
      expect(buildMapContext(state).floorsToNextBoss).toBe(TEST_BOSS.row);
    });
  });
});
