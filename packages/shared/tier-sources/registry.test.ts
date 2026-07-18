import { describe, it, expect } from "vitest";
import { mobalyticsAdapter } from "./mobalytics";
import { tiermakerAdapter } from "./tiermaker";
import { sts2companionAdapter } from "./sts2companion";
import { nat1gamingAdapter } from "./nat1gaming";
import { slaythetierlistAdapter } from "./slaythetierlist";

describe("supportsAutoRefresh flag", () => {
  it("mobalytics opts in", () => {
    expect(mobalyticsAdapter.supportsAutoRefresh).toBe(true);
  });
  it("all other adapters opt out for now", () => {
    for (const a of [tiermakerAdapter, sts2companionAdapter, nat1gamingAdapter, slaythetierlistAdapter]) {
      expect(a.supportsAutoRefresh).toBe(false);
    }
  });
});
