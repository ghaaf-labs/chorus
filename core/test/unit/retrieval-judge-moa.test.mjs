import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { mapToRetrieverSchema } from "../../src/targets/knowledge.mjs";
import { parseMoaSpec } from "../../src/moa.mjs";
import Ajv2020 from "ajv/dist/2020.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = path.resolve(here, "..", "..", "src", "schemas");
const ROLES_DIR = path.resolve(here, "..", "..", "..", "roles");

const ajv = new Ajv2020({ allErrors: true });
const retrieverSchema = JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, "retriever.schema.json"), "utf8"));
const judgeSchema = JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, "judge.schema.json"), "utf8"));

describe("knowledge.mapToRetrieverSchema", () => {
  it("maps a typical knowledge-index 'ok' response", () => {
    const ki = {
      status: "ok",
      results: [
        { source_path: "docs/a.md", score: 8.5, text: "alpha", heading_path: ["A", "B"], doc_type: "code-doc" },
        { source_path: "docs/b.md", score: 4.2, text: "beta" }
      ]
    };
    const out = mapToRetrieverSchema(ki);
    expect(out.verdict).toBe("approve");
    expect(out.chunks).toHaveLength(2);
    expect(out.chunks[0].path).toBe("docs/a.md");
    expect(out.chunks[0].heading_path).toEqual(["A", "B"]);
    expect(out.chunks[0].doc_type).toBe("code-doc");
    expect(out.chunks[1].heading_path).toBeUndefined();
    expect(out.confidence).toBeCloseTo(0.85, 2);
  });

  it("maps 'low_confidence' status to needs-attention", () => {
    const out = mapToRetrieverSchema({ status: "low_confidence", results: [{ source_path: "x", score: 1.0, text: "y" }] });
    expect(out.verdict).toBe("needs-attention");
  });

  it("maps 'no_evidence' status to inconclusive", () => {
    const out = mapToRetrieverSchema({ status: "no_evidence", results: [] });
    expect(out.verdict).toBe("inconclusive");
    expect(out.chunks).toEqual([]);
    expect(out.confidence).toBe(0);
  });

  it("clamps unbounded RRF score to 0..1 confidence", () => {
    const out = mapToRetrieverSchema({ status: "ok", results: [{ source_path: "p", score: 50, text: "t" }] });
    expect(out.confidence).toBe(1.0);
  });

  it("output validates against retriever schema", () => {
    const out = mapToRetrieverSchema({
      status: "ok",
      results: [{ source_path: "p", score: 5, text: "long enough excerpt" }]
    });
    const validate = ajv.compile(retrieverSchema);
    const ok = validate(out);
    if (!ok) console.error(validate.errors);
    expect(ok).toBe(true);
  });
});

describe("moa.parseMoaSpec", () => {
  it("parses single layer", () => {
    expect(parseMoaSpec("l1=grok,codex")).toEqual([["grok", "codex"]]);
  });

  it("parses two layers", () => {
    expect(parseMoaSpec("l1=grok,codex; l2=claude-code")).toEqual([["grok", "codex"], ["claude-code"]]);
  });

  it("rejects bad syntax", () => {
    expect(parseMoaSpec("garbage")).toBeNull();
    expect(parseMoaSpec("")).toBeNull();
    expect(parseMoaSpec("l1=")).toBeNull();
  });
});

describe("retriever role assets", () => {
  it("retriever.md exists with proper frontmatter", () => {
    const md = fs.readFileSync(path.join(ROLES_DIR, "retriever.md"), "utf8");
    expect(md).toMatch(/^---/);
    expect(md).toContain("schema: retriever.schema.json");
    expect(md).toContain("default_target_order: [knowledge]");
  });

  it("judge.md exists with proper frontmatter", () => {
    const md = fs.readFileSync(path.join(ROLES_DIR, "judge.md"), "utf8");
    expect(md).toContain("schema: judge.schema.json");
  });
});

describe("judge schema validates a well-formed result", () => {
  it("accepts a complete judge output", () => {
    const validate = ajv.compile(judgeSchema);
    const sample = {
      verdict: "approve",
      merged_verdict: "approve",
      reasoning: "Two reviewers approved; one was inconclusive due to missing context.",
      sourced_from: [
        { target: "codex", verdict: "approve", weight: 1.0 },
        { target: "grok", verdict: "approve", weight: 1.0 }
      ]
    };
    const ok = validate(sample);
    if (!ok) console.error(validate.errors);
    expect(ok).toBe(true);
  });
});
