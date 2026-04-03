import { describe, it, expect } from "vitest";
import {
  evaluationSlice,
  evalStarted,
  evalSucceeded,
  evalFailed,
  evalRetryRequested,
  evalCleared,
  allEvalsCleared,
} from "../evaluationSlice";

const reducer = evaluationSlice.reducer;
const initial = reducer(undefined, { type: "@@INIT" });

describe("evaluationSlice", () => {
  it("initializes all eval types with empty entries", () => {
    expect(initial.evals.card_reward).toEqual({
      evalKey: "",
      result: null,
      isLoading: false,
      error: null,
    });
    expect(initial.evals.map).toEqual({
      evalKey: "",
      result: null,
      isLoading: false,
      error: null,
    });
  });

  describe("evalStarted", () => {
    it("sets isLoading and evalKey", () => {
      const state = reducer(
        initial,
        evalStarted({ evalType: "card_reward", evalKey: "abc,def" })
      );
      expect(state.evals.card_reward.isLoading).toBe(true);
      expect(state.evals.card_reward.evalKey).toBe("abc,def");
      expect(state.evals.card_reward.error).toBeNull();
    });

    it("clears previous error", () => {
      let state = reducer(
        initial,
        evalFailed({ evalType: "shop", evalKey: "x", error: "fail" })
      );
      state = reducer(state, evalStarted({ evalType: "shop", evalKey: "y" }));
      expect(state.evals.shop.error).toBeNull();
      expect(state.evals.shop.isLoading).toBe(true);
    });
  });

  describe("evalSucceeded", () => {
    it("stores result and clears loading", () => {
      let state = reducer(
        initial,
        evalStarted({ evalType: "event", evalKey: "e1" })
      );
      state = reducer(
        state,
        evalSucceeded({
          evalType: "event",
          evalKey: "e1",
          result: { rankings: [{ tier: "S" }] },
        })
      );
      expect(state.evals.event.result).toEqual({ rankings: [{ tier: "S" }] });
      expect(state.evals.event.isLoading).toBe(false);
    });

    it("ignores stale response (evalKey mismatch)", () => {
      let state = reducer(
        initial,
        evalStarted({ evalType: "card_reward", evalKey: "new_key" })
      );
      state = reducer(
        state,
        evalSucceeded({
          evalType: "card_reward",
          evalKey: "old_key",
          result: { stale: true },
        })
      );
      // Result should NOT be set because evalKey doesn't match
      expect(state.evals.card_reward.result).toBeNull();
      expect(state.evals.card_reward.isLoading).toBe(true);
    });
  });

  describe("evalFailed", () => {
    it("stores error and clears loading", () => {
      let state = reducer(
        initial,
        evalStarted({ evalType: "rest_site", evalKey: "r1" })
      );
      state = reducer(
        state,
        evalFailed({ evalType: "rest_site", evalKey: "r1", error: "timeout" })
      );
      expect(state.evals.rest_site.error).toBe("timeout");
      expect(state.evals.rest_site.isLoading).toBe(false);
    });

    it("ignores stale error", () => {
      let state = reducer(
        initial,
        evalStarted({ evalType: "map", evalKey: "new" })
      );
      state = reducer(
        state,
        evalFailed({ evalType: "map", evalKey: "old", error: "stale" })
      );
      expect(state.evals.map.error).toBeNull();
      expect(state.evals.map.isLoading).toBe(true);
    });
  });

  describe("evalRetryRequested", () => {
    it("clears error, result, and evalKey", () => {
      let state = reducer(
        initial,
        evalSucceeded({
          evalType: "shop",
          evalKey: "s1",
          result: { data: true },
        })
      );
      state = reducer(state, evalRetryRequested("shop"));
      expect(state.evals.shop.result).toBeNull();
      expect(state.evals.shop.error).toBeNull();
      expect(state.evals.shop.evalKey).toBe("");
    });
  });

  describe("evalCleared", () => {
    it("resets a single eval type", () => {
      let state = reducer(
        initial,
        evalSucceeded({
          evalType: "card_reward",
          evalKey: "x",
          result: { yes: true },
        })
      );
      state = reducer(state, evalCleared("card_reward"));
      expect(state.evals.card_reward.result).toBeNull();
      expect(state.evals.card_reward.evalKey).toBe("");
    });

    it("does not affect other eval types", () => {
      let state = reducer(
        initial,
        evalStarted({ evalType: "shop", evalKey: "s" })
      );
      state = reducer(state, evalStarted({ evalType: "event", evalKey: "e" }));
      state = reducer(
        state,
        evalSucceeded({ evalType: "shop", evalKey: "s", result: { shop: true } })
      );
      state = reducer(
        state,
        evalSucceeded({ evalType: "event", evalKey: "e", result: { event: true } })
      );
      state = reducer(state, evalCleared("shop"));
      expect(state.evals.shop.result).toBeNull();
      expect(state.evals.event.result).toEqual({ event: true });
    });
  });

  describe("allEvalsCleared", () => {
    it("resets all eval types", () => {
      let state = reducer(
        initial,
        evalSucceeded({
          evalType: "card_reward",
          evalKey: "c",
          result: { a: 1 },
        })
      );
      state = reducer(
        state,
        evalSucceeded({
          evalType: "map",
          evalKey: "m",
          result: { b: 2 },
        })
      );
      state = reducer(state, allEvalsCleared());
      expect(state.evals.card_reward.result).toBeNull();
      expect(state.evals.map.result).toBeNull();
    });
  });
});
