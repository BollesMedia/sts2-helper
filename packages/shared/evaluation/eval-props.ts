import type { CardRewardEvaluation } from "./types";

/**
 * Standard evaluation props passed to any view that displays AI evaluation results.
 * Components should be dumb — they receive this data, they don't fetch it.
 */
export interface EvalProps {
  evaluation: CardRewardEvaluation | null;
  isLoading: boolean;
  error: string | null;
  onRetry?: () => void;
}
