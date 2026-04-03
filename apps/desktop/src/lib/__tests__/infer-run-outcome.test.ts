import { describe, it, expect } from "vitest";
import { inferRunOutcome, type RunOutcomeInput } from "../infer-run-outcome";

const base: RunOutcomeInput = {
  currentStateType: "map",
  lastWasBoss: false,
  lastEnemiesAllDead: false,
  eventId: null,
  eventName: null,
};

function outcome(overrides: Partial<RunOutcomeInput>) {
  return inferRunOutcome({ ...base, ...overrides });
}

describe("inferRunOutcome", () => {
  describe("victory detection", () => {
    it("detects victory from Architect event by ID", () => {
      expect(outcome({
        currentStateType: "event",
        eventId: "THE_ARCHITECT",
        eventName: "The Architect",
      })).toBe("victory");
    });

    it("detects victory from Architect event by name only", () => {
      expect(outcome({
        currentStateType: "event",
        eventId: null,
        eventName: "Architect",
      })).toBe("victory");
    });

    it("detects victory from boss combat rewards", () => {
      expect(outcome({
        currentStateType: "combat_rewards",
        lastWasBoss: true,
        lastEnemiesAllDead: true,
      })).toBe("victory");
    });

    it("detects victory from boss with all enemies dead (direct)", () => {
      expect(outcome({
        currentStateType: "boss",
        lastWasBoss: true,
        lastEnemiesAllDead: true,
      })).toBe("victory");
    });
  });

  describe("non-victory cases", () => {
    it("returns null for regular combat", () => {
      expect(outcome({
        currentStateType: "monster",
        lastWasBoss: false,
        lastEnemiesAllDead: true,
      })).toBeNull();
    });

    it("returns null for menu transition", () => {
      expect(outcome({ currentStateType: "menu" })).toBeNull();
    });

    it("returns null for boss combat still in progress", () => {
      expect(outcome({
        currentStateType: "boss",
        lastWasBoss: true,
        lastEnemiesAllDead: false,
      })).toBeNull();
    });

    it("returns null for non-architect event", () => {
      expect(outcome({
        currentStateType: "event",
        eventId: "SOME_EVENT",
        eventName: "Doll Room",
      })).toBeNull();
    });

    it("does NOT infer defeat from HP (revival relics exist)", () => {
      // Player HP could hit 0 and be revived — no defeat detection
      expect(outcome({
        currentStateType: "menu",
        lastWasBoss: false,
        lastEnemiesAllDead: false,
      })).toBeNull();
    });
  });
});
