import { nat1gamingAdapter } from "./nat1gaming";
import { tiermakerAdapter } from "./tiermaker";
import type { TierListSourceAdapter } from "./types";

const ADAPTERS: readonly TierListSourceAdapter[] = [
  tiermakerAdapter,
  nat1gamingAdapter,
];

export function listAdapters(): readonly TierListSourceAdapter[] {
  return ADAPTERS;
}

export function resolveAdapter(url: string): TierListSourceAdapter | null {
  return ADAPTERS.find((a) => a.canHandle(url)) ?? null;
}
