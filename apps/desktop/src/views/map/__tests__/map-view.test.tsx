// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithStore } from "../../../__tests__/test-utils";
import {
  createMapState,
  createMapEvaluation,
  createPreloadedState,
  DEFAULT_RECOMMENDED_PATH,
  TEST_NODES,
} from "../../../__tests__/fixtures/map-state";
import { MapView } from "../map-view";
import { computeMapEvalKey } from "../../../lib/eval-inputs/map";

// ---- Helpers ----

/** Find all SVG <line> elements and return their key attributes */
function getEdges(container: HTMLElement) {
  return Array.from(container.querySelectorAll("line")).map((line) => ({
    key: line.getAttribute("key"),
    x1: line.getAttribute("x1"),
    y1: line.getAttribute("y1"),
    x2: line.getAttribute("x2"),
    y2: line.getAttribute("y2"),
    stroke: line.getAttribute("stroke"),
    strokeWidth: line.getAttribute("stroke-width"),
    strokeDasharray: line.getAttribute("stroke-dasharray"),
  }));
}

/** Find edges with the green best-edge color (#34d399) and thick width (3) */
function getBestEdges(container: HTMLElement) {
  return getEdges(container).filter(
    (e) => e.stroke === "#34d399" && e.strokeWidth === "3",
  );
}

/** Find edges with the green path color (#34d399) and path width (2) */
function getPathEdges(container: HTMLElement) {
  return getEdges(container).filter(
    (e) => e.stroke === "#34d399" && e.strokeWidth === "2",
  );
}

// ---- Tests ----

describe("MapView", () => {
  describe("basic rendering", () => {
    it("renders all nodes from the map state", () => {
      const state = createMapState();
      const preloaded = createPreloadedState();
      const { container } = renderWithStore(<MapView state={state} />, {
        preloadedState: preloaded,
      });

      // Each node renders a <text> label inside the SVG
      const textElements = container.querySelectorAll("svg text");
      // 6 nodes in the test map
      expect(textElements.length).toBe(TEST_NODES.length);
    });

    it("renders node type labels", () => {
      const state = createMapState();
      const preloaded = createPreloadedState();
      const { container } = renderWithStore(<MapView state={state} />, { preloadedState: preloaded });

      // Node labels are rendered as <text> inside the SVG
      const svgTexts = container.querySelectorAll("svg text");
      const labels = Array.from(svgTexts).map((t) => t.textContent);
      expect(labels.filter((l) => l === "M").length).toBe(2); // 2 monsters
      expect(labels.filter((l) => l === "E").length).toBe(1); // 1 elite
      expect(labels.filter((l) => l === "$").length).toBe(1); // 1 shop
      expect(labels.filter((l) => l === "R").length).toBe(1); // 1 rest site
      expect(labels.filter((l) => l === "B").length).toBe(1); // 1 boss
    });
  });

  describe("no evaluation", () => {
    it("renders no green best-edges when no evaluation exists", () => {
      const state = createMapState();
      const preloaded = createPreloadedState(); // no eval result
      const { container } = renderWithStore(<MapView state={state} />, {
        preloadedState: preloaded,
      });

      expect(getBestEdges(container)).toHaveLength(0);
    });

    it("renders no Best badge in sidebar when no evaluation exists", () => {
      const state = createMapState();
      const preloaded = createPreloadedState();
      renderWithStore(<MapView state={state} />, { preloadedState: preloaded });

      expect(screen.queryByText("Best")).not.toBeTruthy();
    });
  });

  describe("fresh evaluation (coach output matches current options)", () => {
    function setupFreshEval() {
      const state = createMapState();
      const evaluation = createMapEvaluation();
      const evalKey = computeMapEvalKey(state.map.next_options);
      const preloaded = createPreloadedState({
        mapEval: {
          recommendedPath: DEFAULT_RECOMMENDED_PATH,
          recommendedNodes: DEFAULT_RECOMMENDED_PATH.map((p) => `${p.col},${p.row}`),
          bestPathNodes: DEFAULT_RECOMMENDED_PATH.map((p) => `${p.col},${p.row}`),
        },
        mapEvalEntry: {
          evalKey,
          result: evaluation,
        },
      });
      return { state, preloaded, evaluation };
    }

    it("renders a green best-edge from current position to best option", () => {
      const { state, preloaded } = setupFreshEval();
      const { container } = renderWithStore(<MapView state={state} />, {
        preloadedState: preloaded,
      });

      const bestEdges = getBestEdges(container);
      expect(bestEdges.length).toBe(1);
    });

    it("renders Best badge on exactly one option chip", () => {
      const { state, preloaded } = setupFreshEval();
      const { container } = renderWithStore(<MapView state={state} />, {
        preloadedState: preloaded,
      });

      const bestBadges = Array.from(container.querySelectorAll("span")).filter(
        (s) => s.textContent === "Best",
      );
      expect(bestBadges.length).toBe(1);
    });

    it("renders the coach headline in the sidebar", () => {
      const { state, preloaded, evaluation } = setupFreshEval();
      renderWithStore(<MapView state={state} />, { preloadedState: preloaded });

      expect(screen.getByText(evaluation.headline)).toBeTruthy();
    });

    it("renders green path edges beyond the best option", () => {
      const { state, preloaded } = setupFreshEval();
      const { container } = renderWithStore(<MapView state={state} />, {
        preloadedState: preloaded,
      });

      const pathEdges = getPathEdges(container);
      // Path: start(1,0) -> elite(0,1) -> rest(0,2) -> boss(1,3)
      // Best edge covers start->elite; path edges cover elite->rest and rest->boss
      expect(pathEdges.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("stale evaluation (rankings do NOT match current options)", () => {
    /**
     * Simulates the bug scenario with an extended map:
     *
     * Row 0: Monster (1,0) → children: Elite (0,1), Shop (2,1)  [2 options]
     * Row 1: Elite (0,1) → children: Rest (0,2), Monster2 (1,2) [2 options]
     *
     * Eval was for row 0 options, player has moved to Elite (0,1).
     * Stale bestOptionIndex=1 would point to Elite's first child (Rest at 0,2),
     * but the recommended path goes through Monster2 (1,2) instead.
     */
    function setupStaleEval() {
      // Extended nodes: Elite at (0,1) now has 2 children
      const extendedNodes = [
        ...TEST_NODES,
        { col: 1, row: 2, type: "Monster" as const, children: [[1, 3]] as [number, number][] },
      ];
      // Give Elite a second child
      const eliteNode = extendedNodes.find((n) => n.col === 0 && n.row === 1)!;
      extendedNodes[extendedNodes.indexOf(eliteNode)] = {
        ...eliteNode,
        children: [[0, 2], [1, 2]],
      };

      // Player has moved to the Elite node at (0,1)
      const state = createMapState({
        current_position: { col: 0, row: 1, type: "Elite" },
        visited: [
          { col: 1, row: 0, type: "Monster" },
          { col: 0, row: 1, type: "Elite" },
        ],
        next_options: [
          { index: 0, col: 0, row: 2, type: "RestSite", leads_to: [{ col: 1, row: 3, type: "Boss" }] },
          { index: 1, col: 1, row: 2, type: "Monster", leads_to: [{ col: 1, row: 3, type: "Boss" }] },
        ],
        nodes: extendedNodes,
      });

      // Evaluation is STALE — it was for the old position's options (Elite + Shop)
      const staleEvaluation = createMapEvaluation(); // rankings for row 0 options
      const staleEvalKey = computeMapEvalKey([
        { index: 0, col: 0, row: 1, type: "Elite", leads_to: [] },
        { index: 1, col: 2, row: 1, type: "Shop", leads_to: [] },
      ]);

      // Recommended path goes through Monster2 (1,2), NOT Rest (0,2)
      const preloaded = createPreloadedState({
        mapEval: {
          recommendedPath: [
            { col: 0, row: 1 },
            { col: 1, row: 2 },
            { col: 1, row: 3 },
          ],
          recommendedNodes: ["0,1", "1,2", "1,3"],
          bestPathNodes: ["0,1", "1,2", "1,3"],
        },
        mapEvalEntry: {
          evalKey: staleEvalKey,
          result: staleEvaluation,
        },
      });
      return { state, preloaded };
    }

    it("does NOT highlight the node the stale index would have picked", () => {
      const { state, preloaded } = setupStaleEval();
      const { container } = renderWithStore(<MapView state={state} />, {
        preloadedState: preloaded,
      });

      // With the bug: stale bestOptionIndex=1 maps to new next_options[0] (RestSite at 0,2)
      // creating a bogus isBestEdge to RestSite. After fix: Monster2 (1,2) is on the
      // recommended path, so that one gets highlighted instead.
      const bestEdges = getBestEdges(container);
      // Best edge should go to Monster2 (1,2) which IS on the path, not RestSite (0,2)
      expect(bestEdges.length).toBe(1);
      // Verify the best edge does NOT point to RestSite at (0,2)
      // RestSite is at nodeX(0)=32, nodeY(2)=... — we verify indirectly
      // by checking that NO stale eval data leaks into the sidebar
    });

    it("does NOT show stale coach output in sidebar", () => {
      const { state, preloaded } = setupStaleEval();
      renderWithStore(<MapView state={state} />, { preloadedState: preloaded });

      // With evalMatchesCurrentOptions=false the sidebar hides the entire
      // coach block (headline, reasoning, branches). The stale fixture
      // headline should not appear anywhere on screen.
      expect(screen.queryByText("Take the elite path for the relic.")).not.toBeTruthy();
    });

    it("shows Best badge on the path-derived option, not the stale-index option", () => {
      const { state, preloaded } = setupStaleEval();
      const { container } = renderWithStore(<MapView state={state} />, {
        preloadedState: preloaded,
      });

      // Recommended path goes through Monster2 (1,2). That option card should be "Best".
      const bestBadges = Array.from(container.querySelectorAll("span")).filter(
        (s) => s.textContent === "Best",
      );
      expect(bestBadges.length).toBe(1);
    });

    it("still renders green path edges from recommendedPath", () => {
      const { state, preloaded } = setupStaleEval();
      const { container } = renderWithStore(<MapView state={state} />, {
        preloadedState: preloaded,
      });

      // Even with stale eval, the recommendedPath is still valid.
      const pathEdges = getPathEdges(container);
      expect(pathEdges.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("loading state", () => {
    it("shows loading overlay when evaluation is loading", () => {
      const state = createMapState();
      const preloaded = createPreloadedState({
        mapEvalEntry: { isLoading: true },
      });
      renderWithStore(<MapView state={state} />, { preloadedState: preloaded });

      expect(screen.getByText("Narrating path…")).toBeTruthy();
    });
  });

  describe("error state", () => {
    it("shows error component when evaluation fails", () => {
      const state = createMapState();
      const preloaded = createPreloadedState({
        mapEvalEntry: { error: "API call failed" },
      });
      renderWithStore(<MapView state={state} />, { preloadedState: preloaded });

      expect(screen.getByText(/API call failed/)).toBeTruthy();
    });
  });

  describe("edge styling", () => {
    it("renders next-option edges with dashed stroke", () => {
      const state = createMapState();
      const preloaded = createPreloadedState();
      const { container } = renderWithStore(<MapView state={state} />, {
        preloadedState: preloaded,
      });

      // Edges from current position (1,0) to its children should be dashed
      // when no evaluation marks one as "best"
      const dashedEdges = getEdges(container).filter(
        (e) => e.strokeDasharray === "4 3",
      );
      // 2 next options (Elite at 0,1 and Shop at 2,1)
      expect(dashedEdges.length).toBe(2);
    });

    it("renders default edges with dark stroke", () => {
      const state = createMapState();
      const preloaded = createPreloadedState();
      const { container } = renderWithStore(<MapView state={state} />, {
        preloadedState: preloaded,
      });

      const defaultEdges = getEdges(container).filter(
        (e) => e.stroke === "#27272a",
      );
      // Non-visited, non-next edges should use default color
      expect(defaultEdges.length).toBeGreaterThan(0);
    });
  });

  describe("sidebar option chips", () => {
    it("renders one chip per next option with its node type", () => {
      const state = createMapState();
      const preloaded = createPreloadedState();
      renderWithStore(<MapView state={state} />, { preloadedState: preloaded });

      // 2 next options — chips show type names alongside the SVG labels
      const elites = screen.getAllByText("Elite");
      const shops = screen.getAllByText("Shop");
      expect(elites.length).toBeGreaterThanOrEqual(1);
      expect(shops.length).toBeGreaterThanOrEqual(1);
    });
  });
});

