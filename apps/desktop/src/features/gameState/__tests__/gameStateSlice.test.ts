import { describe, it, expect } from "vitest";
import {
  gameStateSlice,
  gameStateReceived,
  selectCurrentGameState,
  selectPreviousGameState,
  selectGameStateType,
  selectGameStateContentKey,
  selectLastMapContentKey,
  selectGameStateHistory,
} from "../gameStateSlice";
import type { GameState } from "@sts2/shared/types/game-state";

const reducer = gameStateSlice.reducer;
const initial = reducer(undefined, { type: "@@INIT" });

// ---- Fixtures ----

function makeMapState(col: number, row: number): GameState {
  return {
    state_type: "map",
    map: {
      current_position: { col, row, type: "Monster" },
      next_options: [{ col: col + 1, row: row + 1, type: "Monster", index: 0, leads_to: [] }],
      nodes: [],
      boss: { col: 1, row: 15 },
      visited: [],
    },
    run: { act: 1, floor: 5, ascension: 0 },
  } as unknown as GameState;
}

function makeShopState(): GameState {
  return {
    state_type: "shop",
    shop: {
      items: [{ index: 0, card_id: "strike", is_stocked: true, can_afford: true }],
      can_proceed: true,
    },
    run: { act: 1, floor: 6, ascension: 0 },
  } as unknown as GameState;
}

function makeCombatState(round: number): GameState {
  return {
    state_type: "monster",
    battle: {
      round,
      turn: "player",
      is_play_phase: true,
      enemies: [{ entity_id: "jaw_worm", hp: 30 }],
    },
    run: { act: 1, floor: 3, ascension: 0 },
  } as unknown as GameState;
}

// ---- Tests ----

describe("gameStateSlice", () => {
  describe("gameStateReceived", () => {
    it("sets current on first dispatch, previous stays null", () => {
      const map = makeMapState(2, 3);
      const state = reducer(initial, gameStateReceived(map));

      expect(state.current).toBe(map);
      expect(state.previous).toBeNull();
    });

    it("shifts current → previous on second dispatch", () => {
      const map1 = makeMapState(1, 1);
      const map2 = makeMapState(2, 2);

      let state = reducer(initial, gameStateReceived(map1));
      state = reducer(state, gameStateReceived(map2));

      expect(state.current).toBe(map2);
      expect(state.previous).toBe(map1);
    });

    it("skips update when content key matches (dedup)", () => {
      const map = makeMapState(1, 1);
      let state = reducer(initial, gameStateReceived(map));
      // Dispatch same content again (different object, same content key)
      const mapDuplicate = makeMapState(1, 1);
      state = reducer(state, gameStateReceived(mapDuplicate));

      expect(state.current).toBe(map);
      expect(state.previous).toBeNull();
    });

    it("updates when content key differs", () => {
      const map1 = makeMapState(1, 1);
      const map2 = makeMapState(3, 4);

      let state = reducer(initial, gameStateReceived(map1));
      state = reducer(state, gameStateReceived(map2));

      expect(state.current).toBe(map2);
      expect(state.previous).toBe(map1);
    });

    it("tracks lastMapContentKey only for map states", () => {
      const shop = makeShopState();
      const state = reducer(initial, gameStateReceived(shop));

      expect(state.lastMapContentKey).toBeNull();
    });

    it("preserves lastMapContentKey across non-map states", () => {
      const map = makeMapState(2, 3);
      let state = reducer(initial, gameStateReceived(map));

      const expectedKey = state.lastMapContentKey;
      expect(expectedKey).not.toBeNull();

      const shop = makeShopState();
      state = reducer(state, gameStateReceived(shop));

      expect(state.lastMapContentKey).toBe(expectedKey);
    });

    it("updates lastMapContentKey when map content changes", () => {
      const map1 = makeMapState(1, 1);
      let state = reducer(initial, gameStateReceived(map1));
      const key1 = state.lastMapContentKey;

      const map2 = makeMapState(5, 5);
      state = reducer(state, gameStateReceived(map2));
      const key2 = state.lastMapContentKey;

      expect(key1).not.toBeNull();
      expect(key2).not.toBeNull();
      expect(key1).not.toBe(key2);
    });

    it("appends to history in test mode", () => {
      const map = makeMapState(1, 1);
      const state = reducer(initial, gameStateReceived(map));

      expect(state.history).toHaveLength(1);
      expect(state.history[0].data).toBe(map);
      expect(state.history[0].contentKey).toBeTruthy();
      expect(typeof state.history[0].receivedAt).toBe("number");
    });

    it("evicts oldest when history exceeds 30", () => {
      let state = initial;

      // Dispatch 31 distinct map states (each with different position to get different content keys)
      for (let i = 0; i < 31; i++) {
        state = reducer(state, gameStateReceived(makeMapState(i, i)));
      }

      expect(state.history).toHaveLength(30);
      // The oldest (i=0) should be gone; newest (i=30) should be last
      const lastEntry = state.history[state.history.length - 1];
      expect(lastEntry.data).toEqual(makeMapState(30, 30));
    });
  });

  describe("selectors", () => {
    it("selectCurrentGameState returns current", () => {
      const map = makeMapState(1, 1);
      const sliceState = reducer(initial, gameStateReceived(map));
      const rootState = { gameState: sliceState };

      expect(selectCurrentGameState(rootState)).toBe(map);
    });

    it("selectPreviousGameState returns previous", () => {
      const map1 = makeMapState(1, 1);
      const map2 = makeMapState(2, 2);

      let sliceState = reducer(initial, gameStateReceived(map1));
      sliceState = reducer(sliceState, gameStateReceived(map2));
      const rootState = { gameState: sliceState };

      expect(selectPreviousGameState(rootState)).toBe(map1);
    });

    it("selectGameStateType returns state_type of current", () => {
      const combat = makeCombatState(1);
      const sliceState = reducer(initial, gameStateReceived(combat));
      const rootState = { gameState: sliceState };

      expect(selectGameStateType(rootState)).toBe("monster");
    });

    it("selectGameStateType returns null when no current state", () => {
      const rootState = { gameState: initial };
      expect(selectGameStateType(rootState)).toBeNull();
    });

    it("selectGameStateContentKey returns current content key", () => {
      const map = makeMapState(3, 3);
      const sliceState = reducer(initial, gameStateReceived(map));
      const rootState = { gameState: sliceState };

      expect(selectGameStateContentKey(rootState)).toBeTruthy();
      expect(typeof selectGameStateContentKey(rootState)).toBe("string");
    });

    it("selectLastMapContentKey returns the last map content key", () => {
      const map = makeMapState(2, 4);
      const sliceState = reducer(initial, gameStateReceived(map));
      const rootState = { gameState: sliceState };

      expect(selectLastMapContentKey(rootState)).toBeTruthy();
    });

    it("selectGameStateHistory returns history array", () => {
      const map = makeMapState(1, 1);
      const sliceState = reducer(initial, gameStateReceived(map));
      const rootState = { gameState: sliceState };

      expect(selectGameStateHistory(rootState)).toHaveLength(1);
    });
  });
});
