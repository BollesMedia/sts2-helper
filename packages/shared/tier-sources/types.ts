import type { ScaleType } from "../evaluation/tier-normalize";

export interface ScrapedCard {
  tier: string;
  imageUrl: string;
  externalId?: string;
}

export interface ScrapedTierList {
  adapterId: string;
  scaleType: ScaleType;
  scaleConfig?: { map: Record<string, number> };
  detectedCharacter?: string | null;
  cards: ScrapedCard[];
  warnings: string[];
}

export interface TierListSourceAdapter {
  readonly id: string;
  readonly label: string;
  canHandle(url: string): boolean;
  parse(html: string, url: string): ScrapedTierList;
}
