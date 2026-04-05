import { describe, it, expect } from "vitest";
import { computeGameStateContentKey } from "@sts2/shared/evaluation/game-state-content-key";
import type { GameState } from "@sts2/shared/types/game-state";

describe("computeGameStateContentKey", () => {
  describe("map", () => {
    it("produces key in computeMapContentKey format", () => {
      const state = {
        state_type: "map",
        map: {
          current_position: { col: 2, row: 5, type: "MONSTER" },
          next_options: [
            { col: 1, row: 6, type: "ELITE", index: 0, leads_to: [] },
            { col: 3, row: 6, type: "REST", index: 1, leads_to: [] },
          ],
          nodes: [],
          visited: [],
          boss: { col: 3, row: 15 },
        },
        run: { act: 1, floor: 5, ascension: 0 },
      } as unknown as GameState;

      expect(computeGameStateContentKey(state)).toBe("map:2,5:1,6|3,6");
    });

    it("sorts options for stable ordering", () => {
      const stateA = {
        state_type: "map",
        map: {
          current_position: { col: 0, row: 0, type: "START" },
          next_options: [
            { col: 3, row: 1, type: "ELITE", index: 1, leads_to: [] },
            { col: 1, row: 1, type: "MONSTER", index: 0, leads_to: [] },
          ],
          nodes: [],
          visited: [],
          boss: { col: 3, row: 15 },
        },
        run: { act: 1, floor: 1, ascension: 0 },
      } as unknown as GameState;

      const stateB = {
        state_type: "map",
        map: {
          current_position: { col: 0, row: 0, type: "START" },
          next_options: [
            { col: 1, row: 1, type: "MONSTER", index: 0, leads_to: [] },
            { col: 3, row: 1, type: "ELITE", index: 1, leads_to: [] },
          ],
          nodes: [],
          visited: [],
          boss: { col: 3, row: 15 },
        },
        run: { act: 1, floor: 1, ascension: 0 },
      } as unknown as GameState;

      expect(computeGameStateContentKey(stateA)).toBe(computeGameStateContentKey(stateB));
    });

    it("same content with different object refs produces same key", () => {
      const makeState = () => ({
        state_type: "map",
        map: {
          current_position: { col: 2, row: 5, type: "MONSTER" },
          next_options: [{ col: 1, row: 6, type: "REST", index: 0, leads_to: [] }],
          nodes: [],
          visited: [],
          boss: { col: 3, row: 15 },
        },
        run: { act: 1, floor: 5, ascension: 0 },
      }) as unknown as GameState;

      expect(computeGameStateContentKey(makeState())).toBe(computeGameStateContentKey(makeState()));
    });
  });

  describe("card_reward", () => {
    it("uses sorted card IDs", () => {
      const state = {
        state_type: "card_reward",
        card_reward: {
          cards: [
            { id: "strike", index: 0, name: "Strike", type: "ATTACK", cost: "1", star_cost: null, rarity: "BASIC", is_upgraded: false, description: "" },
            { id: "defend", index: 1, name: "Defend", type: "SKILL", cost: "1", star_cost: null, rarity: "BASIC", is_upgraded: false, description: "" },
          ],
          can_skip: true,
        },
        run: { act: 1, floor: 2, ascension: 0 },
      } as unknown as GameState;

      expect(computeGameStateContentKey(state)).toBe("card_reward:defend:Defend,strike:Strike");
    });

    it("different content produces different keys", () => {
      const stateA = {
        state_type: "card_reward",
        card_reward: {
          cards: [
            { id: "strike", index: 0, name: "Strike", type: "ATTACK", cost: "1", star_cost: null, rarity: "BASIC", is_upgraded: false, description: "" },
          ],
          can_skip: true,
        },
        run: { act: 1, floor: 2, ascension: 0 },
      } as unknown as GameState;

      const stateB = {
        state_type: "card_reward",
        card_reward: {
          cards: [
            { id: "bash", index: 0, name: "Bash", type: "ATTACK", cost: "2", star_cost: null, rarity: "COMMON", is_upgraded: false, description: "" },
          ],
          can_skip: true,
        },
        run: { act: 1, floor: 2, ascension: 0 },
      } as unknown as GameState;

      expect(computeGameStateContentKey(stateA)).not.toBe(computeGameStateContentKey(stateB));
    });
  });

  describe("shop", () => {
    it("uses item index/stocked/afford (sorted)", () => {
      const state = {
        state_type: "shop",
        shop: {
          items: [
            { index: 1, category: "card", cost: 50, is_stocked: false, can_afford: true },
            { index: 0, category: "relic", cost: 100, is_stocked: true, can_afford: true },
          ],
          can_proceed: true,
        },
        run: { act: 1, floor: 6, ascension: 0 },
      } as unknown as GameState;

      expect(computeGameStateContentKey(state)).toBe("shop:0:true:true,1:false:true");
    });
  });

  describe("event", () => {
    it("uses event_id + option index/is_locked", () => {
      const state = {
        state_type: "event",
        event: {
          event_id: "big_fish",
          event_name: "Big Fish",
          is_ancient: false,
          in_dialogue: false,
          options: [
            { index: 0, title: "Banana", description: "", is_locked: false, is_proceed: false, was_chosen: false },
            { index: 1, title: "Donut", description: "", is_locked: false, is_proceed: false, was_chosen: false },
          ],
        },
        run: { act: 1, floor: 3, ascension: 0 },
      } as unknown as GameState;

      expect(computeGameStateContentKey(state)).toBe("event:big_fish:0:false,1:false");
    });
  });

  describe("rest_site", () => {
    it("uses sorted option IDs", () => {
      const state = {
        state_type: "rest_site",
        rest_site: {
          options: [
            { index: 1, id: "smith", name: "Smith", description: "", is_enabled: true },
            { index: 0, id: "rest", name: "Rest", description: "", is_enabled: true },
          ],
          can_proceed: false,
        },
        run: { act: 1, floor: 8, ascension: 0 },
      } as unknown as GameState;

      expect(computeGameStateContentKey(state)).toBe("rest_site:rest,smith");
    });
  });

  describe("card_select", () => {
    it("uses prompt + sorted card IDs", () => {
      const state = {
        state_type: "card_select",
        card_select: {
          screen_type: "UPGRADE",
          prompt: "Choose a card to upgrade",
          cards: [
            { id: "strike", index: 0, name: "Strike", type: "ATTACK", cost: "1", star_cost: null, rarity: "BASIC", is_upgraded: false, description: "" },
            { id: "bash", index: 1, name: "Bash", type: "ATTACK", cost: "2", star_cost: null, rarity: "COMMON", is_upgraded: false, description: "" },
          ],
          can_confirm: true,
          can_cancel: false,
        },
        run: { act: 1, floor: 9, ascension: 0 },
      } as unknown as GameState;

      expect(computeGameStateContentKey(state)).toBe("card_select:Choose a card to upgrade:bash:Bash,strike:Strike");
    });
  });

  describe("relic_select", () => {
    it("uses sorted relic IDs", () => {
      const state = {
        state_type: "relic_select",
        relic_select: {
          prompt: "Choose a relic",
          relics: [
            { index: 1, id: "vajra", name: "Vajra", description: "", counter: null },
            { index: 0, id: "bag_of_marbles", name: "Bag of Marbles", description: "", counter: null },
          ],
          can_skip: false,
        },
        run: { act: 1, floor: 4, ascension: 0 },
      } as unknown as GameState;

      expect(computeGameStateContentKey(state)).toBe("relic_select:bag_of_marbles,vajra");
    });
  });

  describe("combat (monster/elite/boss)", () => {
    it("uses state_type + round + turn + sorted enemy entity_id:hp", () => {
      const state = {
        state_type: "monster",
        battle: {
          round: 2,
          turn: "player",
          is_play_phase: true,
          enemies: [
            { entity_id: "jaw_worm", combat_id: 1, name: "Jaw Worm", hp: 30, max_hp: 40, block: 0, status: [], intents: [] },
            { entity_id: "cultist", combat_id: 0, name: "Cultist", hp: 48, max_hp: 48, block: 0, status: [], intents: [] },
          ],
        },
        run: { act: 1, floor: 2, ascension: 0 },
      } as unknown as GameState;

      expect(computeGameStateContentKey(state)).toBe("monster:2:player:cultist:48,jaw_worm:30");
    });

    it("works for elite state type", () => {
      const state = {
        state_type: "elite",
        battle: {
          round: 1,
          turn: "player",
          is_play_phase: true,
          enemies: [
            { entity_id: "gremlin_nob", combat_id: 0, name: "Gremlin Nob", hp: 82, max_hp: 82, block: 0, status: [], intents: [] },
          ],
        },
        run: { act: 1, floor: 6, ascension: 0 },
      } as unknown as GameState;

      expect(computeGameStateContentKey(state)).toBe("elite:1:player:gremlin_nob:82");
    });
  });

  describe("fallback (menu/overlay)", () => {
    it("produces key for menu state using floor=0 when no run", () => {
      const state = {
        state_type: "menu",
        message: "Main menu",
      } as unknown as GameState;

      expect(computeGameStateContentKey(state)).toBe("menu:0");
    });
  });
});
