/** Offered card with both ID (from game state) and name (from deck). */
export interface OfferedCard {
  id: string;
  name: string;
}

// --- Card Reward ---

export type CardRewardOutcome =
  | { type: "picked"; chosenName: string }
  | { type: "skipped" };

export interface DetectCardRewardInput {
  offeredCards: OfferedCard[];
  previousDeckNames: Set<string>;
  currentDeckNames: Set<string>;
}

// --- Shop ---

export interface ShopOutcome {
  purchases: string[];   // names of new cards
  removals: number;      // count of cards removed
  browsedOnly: boolean;  // left without buying or removing
}

export interface DetectShopInput {
  previousDeckNames: Set<string>;
  currentDeckNames: Set<string>;
  previousDeckSize: number;
  currentDeckSize: number;
}

// --- Rest Site ---

export type RestSiteOutcome =
  | { type: "rested" }
  | { type: "upgraded"; cardName: string };

export interface DetectRestSiteInput {
  previousDeckNames: Set<string>;
  currentDeckNames: Set<string>;
}

// --- Map Node ---

export interface MapNode {
  col: number;
  row: number;
  nodeType: string;
}

export type MapNodeOutcome = {
  chosenNode: MapNode;
  recommendedNode: MapNode | null;
  allOptions: MapNode[];
  wasFollowed: boolean;
};

export interface DetectMapNodeInput {
  previousPosition: { col: number; row: number } | null;
  currentPosition: { col: number; row: number };
  recommendedNextNode: MapNode | null;
  nextOptions: MapNode[];
}

// --- Act Path ---

export interface ActPathNode {
  col: number;
  row: number;
  nodeType: string;
}

export interface DeviationNode {
  col: number;
  row: number;
  recommended: string; // nodeType
  actual: string;      // nodeType
}

export interface ActPathRecord {
  act: number;
  recommendedPath: ActPathNode[];
  actualPath: ActPathNode[];
  deviationCount: number;
  deviationNodes: DeviationNode[];
}

// --- Backfill ---

export interface PendingChoiceEntry {
  chosenItemId: string | null;
  floor: number;
  choiceType: string;
  sequence: number;
}

export interface BackfillPayload {
  runId: string;
  floor: number;
  choiceType: string;
  sequence: number;
  recommendedItemId: string | null;
  recommendedTier: string | null;
  wasFollowed: boolean;
  rankingsSnapshot: unknown;
  evalPending: false;
}

// --- Game Context (snapshot at decision time) ---

export interface GameContextSnapshot {
  hpPercent: number;
  gold: number;
  deckSize: number;
  ascension: number;
  act: number;
  character: string;
}
