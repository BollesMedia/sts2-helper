import { describe, it, expect } from "vitest";
import { inferRunOutcome, type RunOutcomeInput } from "../infer-run-outcome";

const base: RunOutcomeInput = {
  currentStateType: "map",
  lastWasBoss: false,
  lastEnemiesAllDead: false,
  lastAct: 1,
  eventId: null,
  eventName: null,
  overlayScreenType: null,
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

    it("detects victory from act 3 boss combat rewards", () => {
      expect(outcome({
        currentStateType: "combat_rewards",
        lastWasBoss: true,
        lastEnemiesAllDead: true,
        lastAct: 3,
      })).toBe("victory");
    });

    it("does NOT detect victory from act 1 boss combat rewards", () => {
      expect(outcome({
        currentStateType: "combat_rewards",
        lastWasBoss: true,
        lastEnemiesAllDead: true,
        lastAct: 1,
      })).toBeNull();
    });

    it("does NOT detect victory from act 2 boss combat rewards", () => {
      expect(outcome({
        currentStateType: "combat_rewards",
        lastWasBoss: true,
        lastEnemiesAllDead: true,
        lastAct: 2,
      })).toBeNull();
    });

    it("does NOT detect victory from boss state alone", () => {
      expect(outcome({
        currentStateType: "boss",
        lastWasBoss: true,
        lastEnemiesAllDead: true,
        lastAct: 3,
      })).toBeNull();
    });
  });

  describe("defeat detection", () => {
    it("detects defeat from NGameOverScreen overlay", () => {
      expect(outcome({
        currentStateType: "overlay",
        overlayScreenType: "NGameOverScreen",
      })).toBe("defeat");
    });

    it("detects defeat from any GameOver overlay variant", () => {
      expect(outcome({
        currentStateType: "overlay",
        overlayScreenType: "SomeGameOverScreen",
      })).toBe("defeat");
    });

    it("does NOT detect defeat from non-GameOver overlay", () => {
      expect(outcome({
        currentStateType: "overlay",
        overlayScreenType: "SettingsScreen",
      })).toBeNull();
    });
  });

  describe("unknown/null cases", () => {
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
  });
});
