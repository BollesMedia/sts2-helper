import { describe, expect, it } from "vitest";
import { classifyDisconnect } from "../useGameState";

describe("classifyDisconnect", () => {
  it("returns mod_incompatible for 5xx with MissingMethodException body", () => {
    const error = {
      status: 500,
      data: JSON.stringify({
        error:
          "Failed to read game state: Method not found: 'Boolean MegaCrit.Sts2.Core.Combat.CombatManager.get_IsPlayPhase()'.",
        exception_type: "System.MissingMethodException",
      }),
    };
    expect(classifyDisconnect(error)).toBe("mod_incompatible");
  });

  it("matches the bare 'Method not found' phrasing too", () => {
    const error = {
      status: 503,
      data: "Internal: Method not found: 'Foo.Bar()'",
    };
    expect(classifyDisconnect(error)).toBe("mod_incompatible");
  });

  it("returns unreachable for FETCH_ERROR status", () => {
    const error = { status: "FETCH_ERROR", data: "ECONNREFUSED" };
    expect(classifyDisconnect(error)).toBe("unreachable");
  });

  it("returns unknown for 5xx without a recognized exception pattern", () => {
    const error = { status: 500, data: "Unexpected internal error" };
    expect(classifyDisconnect(error)).toBe("unknown");
  });

  it("returns unknown for 5xx with non-string body", () => {
    const error = { status: 500, data: { error: "object body" } };
    expect(classifyDisconnect(error)).toBe("unknown");
  });

  it("returns unknown for 4xx errors", () => {
    const error = { status: 404, data: "MissingMethodException" };
    expect(classifyDisconnect(error)).toBe("unknown");
  });

  it("returns unknown for null / non-object input", () => {
    expect(classifyDisconnect(null)).toBe("unknown");
    expect(classifyDisconnect(undefined)).toBe("unknown");
    expect(classifyDisconnect("error")).toBe("unknown");
  });
});
