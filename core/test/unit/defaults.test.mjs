import { describe, it, expect } from "vitest";
import { resolveTarget, defaultTargetOrder, ROLE_NAMES } from "../../src/roles/defaults.mjs";

const FULL_REGISTRY = {
  hosts: {
    "claude-code": { available: true },
    codex: { available: true },
    grok: { available: true },
    opencode: { available: true }
  }
};

describe("roles/defaults.resolveTarget", () => {
  it("uses requested target when available and not self", () => {
    const r = resolveTarget({
      role: "reviewer",
      requested: "codex",
      registry: FULL_REGISTRY,
      source: "claude-code"
    });
    expect(r.target).toBe("codex");
  });

  it("refuses self by default", () => {
    const r = resolveTarget({
      role: "reviewer",
      requested: "codex",
      registry: FULL_REGISTRY,
      source: "codex"
    });
    expect(r.error).toBe("self_target");
  });

  it("allows self when allowSelf=true", () => {
    const r = resolveTarget({
      role: "reviewer",
      requested: "codex",
      registry: FULL_REGISTRY,
      source: "codex",
      allowSelf: true
    });
    expect(r.target).toBe("codex");
  });

  it("returns target_unavailable when requested host missing", () => {
    const r = resolveTarget({
      role: "reviewer",
      requested: "grok",
      registry: { hosts: { grok: { available: false } } },
      source: "claude-code"
    });
    expect(r.error).toBe("target_unavailable");
  });

  it("auto-resolves to first available non-self target by role", () => {
    const r = resolveTarget({
      role: "reviewer",
      registry: FULL_REGISTRY,
      source: "claude-code"
    });
    expect(r.target).toBe("codex");
  });

  it("falls through to next in order if first is unavailable", () => {
    const r = resolveTarget({
      role: "reviewer",
      registry: { hosts: { codex: { available: false }, grok: { available: true } } },
      source: "claude-code"
    });
    expect(r.target).toBe("grok");
  });

  it("returns no_available_target when nothing matches", () => {
    const r = resolveTarget({
      role: "reviewer",
      registry: { hosts: {} },
      source: "claude-code"
    });
    expect(r.error).toBe("no_available_target");
  });
});

describe("ROLE_NAMES", () => {
  it("contains all four canonical roles", () => {
    expect(ROLE_NAMES).toEqual(
      expect.arrayContaining(["reviewer", "researcher", "architect", "devils-advocate"])
    );
  });
});

describe("defaultTargetOrder", () => {
  it("returns a copy (mutation-safe)", () => {
    const a = defaultTargetOrder("reviewer");
    a.push("garbage");
    const b = defaultTargetOrder("reviewer");
    expect(b).not.toContain("garbage");
  });

  it("throws on unknown role", () => {
    expect(() => defaultTargetOrder("nope")).toThrow();
  });
});
