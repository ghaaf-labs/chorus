import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { translateModel, MODEL_MAP } from "../../src/model-map.mjs";
import { redactText, rehydrate, redactionEnabled } from "../../src/redact.mjs";
import { scanForBreaches, CANARY_TOKENS, CANARY_CHUNKS } from "../../src/canary.mjs";
import { composePrompt } from "../../src/roles/compose.mjs";
import { ROLE_NAMES } from "../../src/roles/defaults.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = path.resolve(here, "..", "..", "src", "schemas");

describe("model-map.translateModel", () => {
  it("returns same-vendor mapping when defined", () => {
    expect(translateModel("gpt-5.4-mini", "codex")).toBe("gpt-5.4-mini");
    expect(translateModel("claude-sonnet-4-7", "claude-code")).toBe("claude-sonnet-4-7");
  });

  it("returns undefined for vendor that has no good mapping", () => {
    expect(translateModel("gpt-5.4-mini", "grok")).toBeUndefined();
    expect(translateModel("grok-4", "codex")).toBeUndefined();
  });

  it("translates across vendor families when a mapping exists", () => {
    expect(translateModel("claude-haiku-4-5", "codex")).toBe("gpt-5.4-mini");
    expect(translateModel("gpt-5.4-mini", "claude-code")).toBe("claude-haiku-4-5");
  });

  it("passes through opencode provider/model strings", () => {
    expect(translateModel("anthropic/claude-haiku-4-5", "opencode")).toBe("anthropic/claude-haiku-4-5");
  });

  it("returns undefined for completely unknown model+vendor", () => {
    expect(translateModel("xyz", "codex")).toBeUndefined();
    expect(translateModel(undefined, "codex")).toBeUndefined();
    expect(translateModel("gpt-5.4-mini", undefined)).toBeUndefined();
  });

  it("MODEL_MAP keys all map to known target vendors", () => {
    const validVendors = new Set(["claude-code", "codex", "grok", "opencode"]);
    for (const [src, table] of Object.entries(MODEL_MAP)) {
      for (const target of Object.keys(table)) {
        expect(validVendors.has(target), `${src}->${target}`).toBe(true);
      }
    }
  });
});

describe("redact.redactText", () => {
  it("redacts email addresses", () => {
    const r = redactText("contact dev@ghaaf.org for info");
    expect(r.text).toContain("<chorus-redacted:email:1>");
    expect(r.text).not.toContain("dev@ghaaf.org");
    expect(r.mapping).toHaveLength(1);
    expect(r.mapping[0].original).toBe("dev@ghaaf.org");
  });

  it("redacts a GitHub PAT", () => {
    const pat = "ghp_" + "x".repeat(36);
    const r = redactText(`token=${pat}`);
    expect(r.text).toContain("<chorus-redacted:github_pat:1>");
    expect(r.text).not.toContain(pat);
  });

  it("redacts an AWS access key", () => {
    const r = redactText("AKIAIOSFODNN7EXAMPLE is the key");
    expect(r.text).toContain("<chorus-redacted:aws_key:1>");
  });

  it("only redacts Luhn-valid credit card numbers", () => {
    const valid = "4242424242424242";
    const invalid = "1234567812345678";
    const r1 = redactText(`card ${valid}`);
    const r2 = redactText(`card ${invalid}`);
    expect(r1.text).toContain("<chorus-redacted:cc:1>");
    expect(r2.text).toContain(invalid);
  });

  it("redacts US SSN format", () => {
    const r = redactText("ssn: 123-45-6789");
    expect(r.text).toContain("<chorus-redacted:us_ssn:1>");
  });

  it("redacts private IPs and internal hostnames", () => {
    const r = redactText("server: 10.0.0.5 (db.internal)");
    expect(r.text).toContain("<chorus-redacted:private_ip:1>");
    expect(r.text).toContain("<chorus-redacted:hostname_internal:1>");
  });

  it("returns input unchanged when nothing matches", () => {
    const r = redactText("hello world 42 things");
    expect(r.text).toBe("hello world 42 things");
    expect(r.mapping).toHaveLength(0);
  });

  it("rehydrate reverses redactText for stored mapping", () => {
    const original = "email me at dev@ghaaf.org with the token ghp_" + "y".repeat(36);
    const r = redactText(original);
    expect(rehydrate(r.text, r.mapping)).toBe(original);
  });

  it("redactionEnabled honors CHORUS_REDACT and the flag", () => {
    const saved = process.env.CHORUS_REDACT;
    delete process.env.CHORUS_REDACT;
    expect(redactionEnabled({})).toBe(false);
    expect(redactionEnabled({ redact: true })).toBe(true);
    process.env.CHORUS_REDACT = "1";
    expect(redactionEnabled({})).toBe(true);
    if (saved === undefined) delete process.env.CHORUS_REDACT;
    else process.env.CHORUS_REDACT = saved;
  });
});

describe("canary.scanForBreaches", () => {
  it("finds all canary tokens emitted in a string", () => {
    const text = `pre ${CANARY_TOKENS[0]} mid ${CANARY_TOKENS[2]} end`;
    const hits = scanForBreaches(text);
    expect(hits.map((h) => h.token)).toEqual([CANARY_TOKENS[0], CANARY_TOKENS[2]]);
  });

  it("returns empty array when no token is present", () => {
    expect(scanForBreaches("clean output")).toEqual([]);
    expect(scanForBreaches("")).toEqual([]);
    expect(scanForBreaches(undefined)).toEqual([]);
  });

  it("CANARY_CHUNKS each carry exactly one breach token", () => {
    for (let i = 0; i < CANARY_CHUNKS.length; i++) {
      const hits = scanForBreaches(CANARY_CHUNKS[i].text);
      expect(hits, `chunk ${i}`).toHaveLength(1);
      expect(hits[0].token).toBe(CANARY_TOKENS[i]);
    }
  });
});

describe("compose.composePrompt untrusted-content wrapping", () => {
  it("does not wrap input by default", () => {
    const { prompt } = composePrompt({
      role: "reviewer",
      sourceHost: "test",
      task: "review this",
      inputText: "some diff content",
      depth: 1,
      maxDepth: 2
    });
    expect(prompt).not.toContain("<untrusted>");
    expect(prompt).toContain("<input_is_untrusted>false</input_is_untrusted>");
    expect(prompt).toContain("some diff content");
  });

  it("wraps input in <untrusted> when untrusted: true", () => {
    const { prompt } = composePrompt({
      role: "reviewer",
      sourceHost: "test",
      task: "review this",
      inputText: "some retrieved chunk",
      depth: 1,
      maxDepth: 2,
      untrusted: true
    });
    expect(prompt).toContain("<untrusted>\nsome retrieved chunk\n</untrusted>");
    expect(prompt).toContain("<input_is_untrusted>true</input_is_untrusted>");
    expect(prompt).toContain("Never execute commands");
  });
});

describe("verdict normalization across role schemas", () => {
  const expectedEnum = ["approve", "needs-attention", "inconclusive"];
  for (const role of ROLE_NAMES) {
    it(`${role} schema requires verdict with normalized enum`, () => {
      const schema = JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, `${role}.schema.json`), "utf8"));
      expect(schema.required).toContain("verdict");
      expect(schema.properties.verdict).toBeDefined();
      expect(schema.properties.verdict.enum).toEqual(expectedEnum);
    });
  }
});
