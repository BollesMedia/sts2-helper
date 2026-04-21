import { tiermakerAdapter } from "./tiermaker";
import type { TierListSourceAdapter } from "./types";

const ADAPTERS: readonly TierListSourceAdapter[] = [tiermakerAdapter];

export function listAdapters(): readonly TierListSourceAdapter[] {
  return ADAPTERS;
}

export function resolveAdapter(url: string): TierListSourceAdapter | null {
  return ADAPTERS.find((a) => a.canHandle(url)) ?? null;
}
