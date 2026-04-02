"use client";

import { createContext, useContext, useCallback, useRef, type ReactNode } from "react";

/**
 * Context for map evaluation state that persists across component remounts.
 * Holds the recommended path and evaluation context so they survive
 * combat → map transitions without localStorage on every render.
 *
 * Syncs to localStorage on write for refresh/reconnect persistence.
 */

interface MapEvalState {
  recommendedPath: { col: number; row: number }[];
  evalContext: {
    hpPercent: number;
    deckSize: number;
    act: number;
    recommendedNodesList: string[];
  } | null;
}

interface MapEvalContextValue {
  getPath: () => { col: number; row: number }[];
  setPath: (path: { col: number; row: number }[]) => void;
  getEvalContext: () => MapEvalState["evalContext"];
  setEvalContext: (ctx: MapEvalState["evalContext"]) => void;
}

const STORAGE_KEY = "sts2-map-eval-state";

function loadFromStorage(): MapEvalState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { recommendedPath: [], evalContext: null };
}

function saveToStorage(state: MapEvalState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

const Ctx = createContext<MapEvalContextValue | null>(null);

export function MapEvalProvider({ children }: { children: ReactNode }) {
  const stateRef = useRef<MapEvalState>(loadFromStorage());

  const getPath = useCallback(() => stateRef.current.recommendedPath, []);

  const setPath = useCallback((path: { col: number; row: number }[]) => {
    stateRef.current = { ...stateRef.current, recommendedPath: path };
    saveToStorage(stateRef.current);
  }, []);

  const getEvalContext = useCallback(() => stateRef.current.evalContext, []);

  const setEvalContext = useCallback((ctx: MapEvalState["evalContext"]) => {
    stateRef.current = { ...stateRef.current, evalContext: ctx };
    saveToStorage(stateRef.current);
  }, []);

  return (
    <Ctx.Provider value={{ getPath, setPath, getEvalContext, setEvalContext }}>
      {children}
    </Ctx.Provider>
  );
}

export function useMapEvalState() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMapEvalState must be used within MapEvalProvider");
  return ctx;
}
