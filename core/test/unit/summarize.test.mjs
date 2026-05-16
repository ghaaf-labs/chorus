import { describe, it, expect } from "vitest";
import { extractJsonObject, validateAndTrim } from "../../src/summarize.mjs";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "summary"],
  properties: {
    verdict: { type: "string", enum: ["approve", "needs-attention"] },
    summary: { type: "string", minLength: 1 }
  }
};

describe("summarize.extractJsonObject", () => {
  it("parses pure JSON", () => {
    expect(extractJsonObject('{"x":1}')).toEqual({ x: 1 });
  });

  it("unwraps ```json fences", () => {
    expect(extractJsonObject('```json\n{"x":2}\n```')).toEqual({ x: 2 });
  });

  it("finds first brace … last brace", () => {
    expect(extractJsonObject('prologue {"x":3} epilogue')).toEqual({ x: 3 });
  });

  it("returns null on garbage", () => {
    expect(extractJsonObject("just words")).toBe(null);
  });
});

describe("summarize.validateAndTrim", () => {
  it("accepts a valid object and returns ok", () => {
    const r = validateAndTrim({
      raw: '{"verdict":"approve","summary":"all good"}',
      schema: SCHEMA
    });
    expect(r.ok).toBe(true);
    expect(r.result.verdict).toBe("approve");
  });

  it("rejects an object that violates schema", () => {
    const r = validateAndTrim({
      raw: '{"verdict":"maybe","summary":"hmm"}',
      schema: SCHEMA
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("schema_violation");
    expect(r.reason).toBe("schema_invalid");
  });

  it("rejects unparseable raw text", () => {
    const r = validateAndTrim({
      raw: "not json at all",
      schema: SCHEMA
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("schema_violation");
    expect(r.reason).toBe("could_not_parse_json");
  });

  it("truncates long string fields", () => {
    const r = validateAndTrim({
      raw: JSON.stringify({ verdict: "approve", summary: "x".repeat(20_000) }),
      schema: SCHEMA,
      maxChars: 1000
    });
    expect(r.ok).toBe(true);
    expect(r.result.summary.length).toBeLessThan(20_000);
    expect(r.fields_truncated.length).toBe(1);
  });
});
