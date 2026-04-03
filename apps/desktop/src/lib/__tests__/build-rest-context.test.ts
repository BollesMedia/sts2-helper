import { describe, it, expect } from "vitest";
import { buildRestContext, type RestContextInput } from "../build-rest-context";

const base: RestContextInput = {
  hp: 60,
  maxHp: 86,
  floorsToNextBoss: 5,
  hasEliteAhead: false,
  hasRestAhead: false,
  relicDescriptions: [],
  upgradeCandidates: ["Strike", "Bash", "True Grit"],
};

function ctx(overrides: Partial<RestContextInput>) {
  return buildRestContext({ ...base, ...overrides });
}

describe("buildRestContext", () => {
  describe("HP calculations", () => {
    it("computes missing HP correctly", () => {
      const result = ctx({});
      expect(result.missing).toBe(26);
      expect(result.missingPercent).toBe(30);
    });

    it("computes hpPercent as fraction", () => {
      const result = ctx({ hp: 43, maxHp: 86 });
      expect(result.hpPercent).toBe(0.5);
    });

    it("handles full HP", () => {
      const result = ctx({ hp: 86, maxHp: 86 });
      expect(result.missing).toBe(0);
      expect(result.missingPercent).toBe(0);
      expect(result.effectiveMissing).toBe(0);
    });
  });

  describe("passive healing from relics", () => {
    it("extracts healing from relic description", () => {
      const result = ctx({
        relicDescriptions: ["Burning Blood: At the end of combat, heal 6 HP"],
      });
      expect(result.passiveHealPerCombat).toBe(6);
    });

    it("detects Meat on the Bone", () => {
      const result = ctx({
        relicDescriptions: ["Meat on the Bone: something something"],
      });
      expect(result.passiveHealPerCombat).toBe(6);
    });

    it("stacks multiple healing relics", () => {
      const result = ctx({
        relicDescriptions: [
          "Burning Blood: At the end of combat, heal 6 HP",
          "Meat on the Bone: heal below 50%",
        ],
      });
      expect(result.passiveHealPerCombat).toBe(12);
    });

    it("returns 0 with no healing relics", () => {
      const result = ctx({ relicDescriptions: ["Vajra: Start each combat with 1 Strength"] });
      expect(result.passiveHealPerCombat).toBe(0);
    });
  });

  describe("boss proximity", () => {
    it("isBossNext when 1 floor away", () => {
      const result = ctx({ floorsToNextBoss: 1 });
      expect(result.isBossNext).toBe(true);
      expect(result.isBossSoon).toBe(true);
    });

    it("isBossSoon when 3 floors away", () => {
      const result = ctx({ floorsToNextBoss: 3 });
      expect(result.isBossNext).toBe(false);
      expect(result.isBossSoon).toBe(true);
    });

    it("neither when far away", () => {
      const result = ctx({ floorsToNextBoss: 10 });
      expect(result.isBossNext).toBe(false);
      expect(result.isBossSoon).toBe(false);
    });

    it("disables passive healing when boss is next", () => {
      const result = ctx({
        floorsToNextBoss: 1,
        relicDescriptions: ["Burning Blood: At the end of combat, heal 6 HP"],
      });
      expect(result.effectivePassiveHeal).toBe(0);
      expect(result.effectiveMissing).toBe(26);
    });

    it("applies passive healing when boss is not next", () => {
      const result = ctx({
        floorsToNextBoss: 5,
        relicDescriptions: ["Burning Blood: At the end of combat, heal 6 HP"],
      });
      expect(result.effectivePassiveHeal).toBe(6);
      expect(result.effectiveMissing).toBe(20);
    });
  });

  describe("elite ahead", () => {
    it("reports elite ahead when not boss next", () => {
      const result = ctx({ hasEliteAhead: true, floorsToNextBoss: 5 });
      expect(result.hasEliteAhead).toBe(true);
    });

    it("suppresses elite ahead when boss is next (boss takes priority)", () => {
      const result = ctx({ hasEliteAhead: true, floorsToNextBoss: 1 });
      expect(result.hasEliteAhead).toBe(false);
    });
  });

  describe("upgrade note", () => {
    it("lists eligible cards", () => {
      const result = ctx({ upgradeCandidates: ["Strike", "Bash"] });
      expect(result.upgradeNote).toContain("Strike");
      expect(result.upgradeNote).toContain("Bash");
      expect(result.upgradeNote).toContain("UPGRADEABLE");
    });

    it("deduplicates candidates", () => {
      const result = ctx({ upgradeCandidates: ["Strike", "Strike", "Bash"] });
      const matches = result.upgradeNote.match(/Strike/g);
      expect(matches).toHaveLength(1);
    });

    it("shows no upgradeable message when empty", () => {
      const result = ctx({ upgradeCandidates: [] });
      expect(result.upgradeNote).toContain("No upgradeable cards remaining");
    });
  });
});
