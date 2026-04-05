import { describe, it, expect, beforeEach } from "vitest";
import {
  registerPendingChoice,
  getPendingChoice,
  clearPendingChoice,
  clearAllPendingChoices,
} from "./pending-choice-registry";

beforeEach(() => {
  clearAllPendingChoices();
});

describe("pending-choice-registry", () => {
  it("returns undefined for unregistered key", () => {
    expect(getPendingChoice(1, "card_reward")).toBeUndefined();
  });

  it("stores and retrieves a pending choice", () => {
    registerPendingChoice(3, "card_reward", "Carnage", 0);
    expect(getPendingChoice(3, "card_reward")).toEqual({
      chosenItemId: "Carnage",
      floor: 3,
      choiceType: "card_reward",
      sequence: 0,
    });
  });

  it("stores null chosenItemId for skips", () => {
    registerPendingChoice(5, "card_reward", null, 0);
    expect(getPendingChoice(5, "card_reward")?.chosenItemId).toBeNull();
  });

  it("clears a specific pending choice", () => {
    registerPendingChoice(3, "card_reward", "Carnage", 0);
    clearPendingChoice(3, "card_reward");
    expect(getPendingChoice(3, "card_reward")).toBeUndefined();
  });

  it("clears all pending choices", () => {
    registerPendingChoice(3, "card_reward", "Carnage", 0);
    registerPendingChoice(5, "map_node", "2,3", 0);
    clearAllPendingChoices();
    expect(getPendingChoice(3, "card_reward")).toBeUndefined();
    expect(getPendingChoice(5, "map_node")).toBeUndefined();
  });

  it("overwrites existing entry for same key", () => {
    registerPendingChoice(3, "card_reward", "Carnage", 0);
    registerPendingChoice(3, "card_reward", "Uppercut", 0);
    expect(getPendingChoice(3, "card_reward")?.chosenItemId).toBe("Uppercut");
  });

  it("keeps separate entries for different floors", () => {
    registerPendingChoice(3, "card_reward", "Carnage", 0);
    registerPendingChoice(5, "card_reward", "Uppercut", 0);
    expect(getPendingChoice(3, "card_reward")?.chosenItemId).toBe("Carnage");
    expect(getPendingChoice(5, "card_reward")?.chosenItemId).toBe("Uppercut");
  });
});
