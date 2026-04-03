import { describe, it, expect } from "vitest";
import { snapshotShape } from "./validate-game-state";

describe("snapshotShape", () => {
  it("describes primitive types without values", () => {
    const result = snapshotShape({ name: "hello", count: 42, active: true });
    expect(result).toEqual({
      name: "string",
      count: "number",
      active: "boolean",
    });
  });

  it("describes null as 'null', not 'object'", () => {
    const result = snapshotShape({ value: null });
    expect(result).toEqual({ value: "null" });
  });

  it("describes empty arrays", () => {
    const result = snapshotShape({ items: [] });
    expect(result).toEqual({ items: "array(0)" });
  });

  it("describes arrays with first-element sampling", () => {
    const result = snapshotShape({
      players: [
        { name: "Alice", hp: 100 },
        { name: "Bob", hp: 80 },
      ],
    });
    expect(result).toEqual({
      players: 'array(2) [{"name":"string","hp":"number"}]',
    });
  });

  it("recurses to 3 levels deep by default", () => {
    const result = snapshotShape({
      battle: {
        player: {
          hand: [{ name: "Strike", description: "Deal 6 damage" }],
          hp: 70,
        },
        enemies: [{ name: "Louse", hp: 11 }],
      },
    });
    expect(result).toEqual({
      battle: {
        player: {
          hand: "array(1)",
          hp: "number",
        },
        enemies: 'array(1) ["object"]',
      },
    });
  });

  it("stops at depth 0 with type summaries", () => {
    const result = snapshotShape({ nested: { deep: true } }, 0);
    expect(result).toEqual({ _value: "object" });
  });

  it("handles empty objects", () => {
    const result = snapshotShape({});
    expect(result).toEqual({});
  });

  it("handles non-object input", () => {
    expect(snapshotShape("hello")).toEqual({ _value: "string" });
    expect(snapshotShape(42)).toEqual({ _value: "number" });
    expect(snapshotShape(null)).toEqual({ _value: "null" });
  });

  it("returns fallback shape when snapshot exceeds 10KB", () => {
    const huge: Record<string, unknown> = {};
    for (let i = 0; i < 500; i++) {
      huge[`key_${i}`] = { nested: { deep: { value: "test" } } };
    }
    const result = snapshotShape(huge, 3);
    expect(result).toHaveProperty("_truncated", true);
  });

  it("never throws on unexpected input", () => {
    expect(() => snapshotShape(undefined)).not.toThrow();
    expect(() => snapshotShape(Symbol("test") as unknown)).not.toThrow();
  });
});
