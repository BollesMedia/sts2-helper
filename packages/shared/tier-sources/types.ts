import type { ScaleType } from "../evaluation/tier-normalize";

export interface ScrapedCard {
  tier: string;
  imageUrl: string;
  externalId?: string;
  /**
   * Card name as declared by the source (e.g. `alt` attribute). When
   * present, the scrape route uses this for matching *before* falling back
   * to filename/pHash. Adapters that can't reliably extract a name should
   * leave this undefined.
   */
  name?: string;
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
