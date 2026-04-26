import { describe, it, expect } from "vitest";
import { buildMapContext } from "../build-map-context";
import { createMapState, TEST_BOSS } from "../../__tests__/fixtures/map-state";

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

    it("detects boss via children even when leads_to is empty (act 3 endgame)", () => {
      // Reproduces: Act 3 floor 47, two rest sites before boss.
      // leads_to was empty in real game data, but children correctly
      // link the rest sites to the boss node.
      const state = createMapState({
        current_position: { col: 2, row: 14, type: "Monster" },
        next_options: [
          { index: 0, col: 1, row: 15, type: "RestSite", leads_to: [] },
          { index: 1, col: 3, row: 15, type: "RestSite", leads_to: [] },
        ],
        nodes: [
          { col: 2, row: 14, type: "Monster", children: [[1, 15], [3, 15]] },
          { col: 1, row: 15, type: "RestSite", children: [[3, 16]] },
          { col: 3, row: 15, type: "RestSite", children: [[3, 16]] },
          { col: 3, row: 16, type: "Boss", children: [] },
        ],
        boss: { col: 3, row: 16 },
      });
      const ctx = buildMapContext(state);
      expect(ctx.hasBossAhead).toBe(true);
      expect(ctx.floorsToNextBoss).toBe(2); // 16 - 14
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
      // Default: current row 0, boss row 3, run.floor 1 → min(17-1, 3-0) = 3
      expect(result.floorsToNextBoss).toBe(3);
    });

    it("uses row 0 when current_position is null", () => {
      const state = createMapState({ current_position: null });
      expect(buildMapContext(state).floorsToNextBoss).toBe(TEST_BOSS.row);
    });

    // #72: rest site on Act 1 floor 16 — boss is next floor (17) but
    // current_position.row can still point to the last combat node. Row
    // math returns 3+; run.floor against the boss floor table returns 1.
    // The fixed floor table wins, correctly reporting "boss is next".
    it("returns 1 when on floor 16 rest site even when current_position.row lags", () => {
      const state = createMapState({
        current_position: { col: 1, row: 12, type: "Monster" },
        boss: { col: 1, row: 15 },
        run: { act: 1, floor: 16, ascension: 10 },
      });
      expect(buildMapContext(state).floorsToNextBoss).toBe(1);
    });

    it("returns 0 when on the boss floor itself (floor 17)", () => {
      const state = createMapState({
        current_position: { col: 1, row: 15, type: "Boss" },
        boss: { col: 1, row: 15 },
        run: { act: 1, floor: 17, ascension: 10 },
      });
      expect(buildMapContext(state).floorsToNextBoss).toBe(0);
    });

    it("returns 14 floors to the Act 2 boss from floor 20", () => {
      // Act 2 boss is global floor 34; current floor 20 → 14 floors away.
      // Row math would report 14 from null current_position + bossRow 14,
      // which coincides — either way the correct answer is 14.
      const state = createMapState({
        current_position: null,
        boss: { col: 1, row: 14 },
        run: { act: 2, floor: 20, ascension: 10 },
      });
      expect(buildMapContext(state).floorsToNextBoss).toBe(14);
    });

    it("prefers the smaller value when row math and floor math disagree", () => {
      // If row math claims closer distance than floor math, trust it.
      // This happens on maps where rows are compressed or the boss was
      // surfaced unusually close.
      const state = createMapState({
        current_position: { col: 1, row: 14, type: "Monster" },
        boss: { col: 1, row: 15 },
        run: { act: 1, floor: 15, ascension: 10 },
      });
      // Floor math: 17 - 15 = 2. Row math: 15 - 14 = 1. Min = 1.
      expect(buildMapContext(state).floorsToNextBoss).toBe(1);
    });
  });
});
