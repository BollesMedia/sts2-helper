import { mobalyticsAdapter } from "./mobalytics";
import { nat1gamingAdapter } from "./nat1gaming";
import { slaythetierlistAdapter } from "./slaythetierlist";
import { sts2companionAdapter } from "./sts2companion";
import { tiermakerAdapter } from "./tiermaker";
import type { TierListSourceAdapter } from "./types";

const ADAPTERS: readonly TierListSourceAdapter[] = [
  tiermakerAdapter,
  nat1gamingAdapter,
  slaythetierlistAdapter,
  mobalyticsAdapter,
  sts2companionAdapter,
];

export function listAdapters(): readonly TierListSourceAdapter[] {
  return ADAPTERS;
}

export function resolveAdapter(url: string): TierListSourceAdapter | null {
  return ADAPTERS.find((a) => a.canHandle(url)) ?? null;
}
