import { describe, it, expect } from "vitest";
import { shouldResumeRun } from "../should-resume-run";
import type { RunData } from "../runSlice";

function makeRun(overrides: Partial<RunData> = {}): RunData {
  return {
    character: "The Ironclad",
    ascension: 8,
    act: 2,
    floor: 21,
    gameMode: "singleplayer",
    deck: [
      { name: "Strike", description: "" },
      { name: "Defend", description: "" },
    ],
    player: null,
    mapEval: {
      recommendedPath: [],
      recommendedNodes: [],
      bestPathNodes: [],
      lastEvalContext: null,
      nodePreferences: null,
    },
    mapContext: null,
    runIdSource: null,
    ...overrides,
  };
}

const baseArgs = {
  isFirstRunTransition: true,
  character: "The Ironclad",
  ascension: 8,
  currentFloor: 21,
  currentAct: 2,
};

describe("shouldResumeRun", () => {
  it("resumes when all fields match on the first in-run transition", () => {
    expect(
      shouldResumeRun({ ...baseArgs, existingRun: makeRun() })
    ).toBe(true);
  });

  it("rejects when not the first in-run transition (mid-session new run)", () => {
    expect(
      shouldResumeRun({
        ...baseArgs,
        isFirstRunTransition: false,
        existingRun: makeRun(),
      })
    ).toBe(false);
  });

  it("rejects when existingRun is null", () => {
    expect(shouldResumeRun({ ...baseArgs, existingRun: null })).toBe(false);
  });

  it("rejects when persisted deck is empty", () => {
    expect(
      shouldResumeRun({ ...baseArgs, existingRun: makeRun({ deck: [] }) })
    ).toBe(false);
  });

  it("rejects when character differs", () => {
    expect(
      shouldResumeRun({
        ...baseArgs,
        existingRun: makeRun({ character: "The Silent" }),
      })
    ).toBe(false);
  });

  it("rejects when ascension differs", () => {
    expect(
      shouldResumeRun({
        ...baseArgs,
        existingRun: makeRun({ ascension: 0 }),
      })
    ).toBe(false);
  });

  it("rejects when starting a brand-new run as the same character (floor/act mismatch)", () => {
    // Persisted: The Ironclad A8 at act 2 floor 21
    // Current game: fresh run as The Ironclad A8 at act 1 floor 1
    expect(
      shouldResumeRun({
        ...baseArgs,
        currentAct: 1,
        currentFloor: 1,
        existingRun: makeRun(),
      })
    ).toBe(false);
  });

  it("rejects when floor matches but act differs", () => {
    expect(
      shouldResumeRun({
        ...baseArgs,
        currentAct: 3,
        existingRun: makeRun(),
      })
    ).toBe(false);
  });

  it("reproduces the original bug: save & quit → relaunch game → open app (game at menu first)", () => {
    // Scenario the user hit: closed both → reopened STS2 (lands on main menu)
    // → opened desktop app (first poll sees state_type 'menu') → clicked
    // Continue (second poll sees state_type 'map' at the persisted floor).
    //
    // Under the old logic, the resume guard `prevStateType === null` failed on
    // the second poll because the first poll had already set prevStateType to
    // 'menu'. The fix replaces that guard with isFirstRunTransition, which is
    // still true at the first menu→in-run transition regardless of how many
    // menu polls preceded it.
    const existingRun = makeRun({ act: 2, floor: 21 });
    expect(
      shouldResumeRun({
        isFirstRunTransition: true,
        existingRun,
        character: "The Ironclad",
        ascension: 8,
        currentFloor: 21,
        currentAct: 2,
      })
    ).toBe(true);
  });
});
