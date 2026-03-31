"use client";

import { useCallback, useRef, useState } from "react";
import { getCached, setCache } from "../lib/local-cache";

interface UseEvaluationConfig<T> {
  /** localStorage key for this evaluation type */
  cacheKey: string;
  /** Deduplication key derived from current inputs (e.g. sorted card IDs) */
  evalKey: string;
  /** Whether evaluation should proceed (false skips entirely) */
  enabled: boolean;
  /** Async function that performs the actual API fetch and returns the result */
  fetcher: () => Promise<T>;
  /**
   * Optional pre-eval callback that can short-circuit the fetch.
   * Return a value to skip the API call entirely, or null to proceed.
   */
  preEval?: () => T | null;
}

interface UseEvaluationResult<T> {
  evaluation: T | null;
  isLoading: boolean;
  error: string | null;
  retry: () => void;
}

/**
 * Base hook that encapsulates the shared evaluation pattern:
 * - localStorage caching with key-based invalidation
 * - Deduplication via evalKey ref
 * - Loading/error state management
 * - Optional preEval short-circuit before fetch
 * - Auto-trigger on evalKey change (render-time, not useEffect)
 * - Retry support (resets state to allow re-evaluation)
 */
function useEvaluation<T>(config: UseEvaluationConfig<T>): UseEvaluationResult<T> {
  const { cacheKey, evalKey, enabled, fetcher, preEval } = config;

  // Check cache before initializing state
  const cachedRef = useRef<string | null>(null);
  const initialEval =
    cachedRef.current !== evalKey ? getCached<T>(cacheKey, evalKey) : null;

  const [evaluation, setEvaluation] = useState<T | null>(initialEval);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const evaluatedKey = useRef<string>(initialEval ? evalKey : "");

  // Track the current evalKey for cache init
  cachedRef.current = evalKey;

  const evaluate = useCallback(async () => {
    if (evalKey === evaluatedKey.current) return;

    // Check localStorage cache first
    const cached = getCached<T>(cacheKey, evalKey);
    if (cached) {
      evaluatedKey.current = evalKey;
      setEvaluation(cached);
      return;
    }

    evaluatedKey.current = evalKey;
    setIsLoading(true);
    setError(null);

    // Run optional pre-eval short-circuit
    if (preEval) {
      const preResult = preEval();
      if (preResult !== null) {
        setEvaluation(preResult);
        setCache(cacheKey, evalKey, preResult);
        setIsLoading(false);
        return;
      }
    }

    try {
      const data = await fetcher();
      setEvaluation(data);
      setCache(cacheKey, evalKey, data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluation failed");
    } finally {
      setIsLoading(false);
    }
  }, [evalKey, cacheKey, fetcher, preEval]);

  const retry = () => {
    evaluatedKey.current = "";
    setError(null);
    setEvaluation(null);
  };

  // Trigger evaluation (not in useEffect -- runs during render check)
  if (enabled && evalKey !== evaluatedKey.current && !isLoading) {
    evaluate();
  }

  return { evaluation, isLoading, error, retry };
}

export { useEvaluation };
export type { UseEvaluationConfig, UseEvaluationResult };
