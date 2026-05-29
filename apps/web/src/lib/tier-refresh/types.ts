export type RefreshTrigger = "cron" | "manual";

export type RefreshStatus =
  | "applied"
  | "partial"
  | "queued"
  | "failed"
  | "no_data";

/** One section's gate evaluation. */
export interface SectionGateResult {
  detectedCharacter: string | null;
  passed: boolean;
  checks: Array<{
    name: "match_rate" | "adapter_warnings" | "entry_count_delta";
    value: number;
    threshold: number;
    prior?: number;
    current?: number;
  }>;
}

export interface CoverageGateResult {
  priorCharacters: string[];
  currentCharacters: string[];
  passed: boolean;
}

export interface GateResult {
  perSection: SectionGateResult[];
  sourceLevel: { coverage: CoverageGateResult };
}

export interface RefreshResult {
  status: RefreshStatus;
  sectionsAttempted: number;
  sectionsApplied: number;
  sectionsQueued: number;
  reason?: string;
  errorDetail?: unknown;
}
