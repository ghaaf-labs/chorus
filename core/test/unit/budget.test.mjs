import { describe, it, expect } from "vitest";
import { truncateInput, truncateDeep, truncateString, DEFAULTS } from "../../src/budget.mjs";

describe("budget.truncateInput", () => {
  it("passes short input through", () => {
    const r = truncateInput("hello", 100);
    expect(r.truncated).toBe(false);
    expect(r.text).toBe("hello");
  });

  it("truncates with head+tail+marker", () => {
    const big = "a".repeat(10_000) + "b".repeat(10_000);
    const r = truncateInput(big, 1000);
    expect(r.truncated).toBe(true);
    expect(r.original_bytes).toBe(20_000);
    expect(r.text).toContain("chorus: truncated");
    expect(r.text.length).toBeLessThan(big.length);
  });
});

describe("budget.truncateString", () => {
  it("returns string unchanged below cap", () => {
    expect(truncateString("short", 100)).toBe("short");
  });
  it("truncates with marker", () => {
    const s = "x".repeat(500);
    const out = truncateString(s, 100);
    expect(out.length).toBeLessThan(s.length);
    expect(out).toContain("[+");
  });
});

describe("budget.truncateDeep", () => {
  it("truncates long string fields in nested objects", () => {
    const fields = [];
    const result = truncateDeep({
      summary: "x".repeat(10_000),
      findings: [{ body: "y".repeat(10_000), file: "ok.js" }]
    }, 100, fields);
    expect(result.summary.length).toBeLessThan(200);
    expect(result.findings[0].body.length).toBeLessThan(200);
    expect(result.findings[0].file).toBe("ok.js");
    expect(fields.length).toBe(2);
  });

  it("leaves numbers and arrays alone", () => {
    const fields = [];
    const r = truncateDeep({ n: 5, arr: [1, 2, 3] }, 100, fields);
    expect(r).toEqual({ n: 5, arr: [1, 2, 3] });
    expect(fields).toHaveLength(0);
  });
});

describe("budget.DEFAULTS", () => {
  it("has sane defaults", () => {
    expect(DEFAULTS.timeout_s).toBeGreaterThanOrEqual(60);
    expect(DEFAULTS.input_max_bytes).toBeGreaterThanOrEqual(1024);
    expect(DEFAULTS.summary_max_chars).toBeGreaterThanOrEqual(1000);
  });
});
