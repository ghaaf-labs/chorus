import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { redactText } from "../../src/redact.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..", "..", "..");

describe("M12.1 — package.json publish hygiene", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

  it("version is real semver (not '0.1.0-dev')", () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/);
    expect(pkg.version).not.toBe("0.1.0-dev");
  });

  it("declares a `files` whitelist (no implicit ship of node_modules / logs)", () => {
    expect(Array.isArray(pkg.files)).toBe(true);
    expect(pkg.files).toContain("bin/");
    expect(pkg.files).toContain("core/src/");
    expect(pkg.files).toContain("roles/");
    expect(pkg.files).toContain("docs/");
    expect(pkg.files).toContain("examples/");
    expect(pkg.files).toContain("LICENSE");
    expect(pkg.files).toContain("README.md");
  });

  it("publishConfig.access is 'public' (scoped package)", () => {
    expect(pkg.publishConfig?.access).toBe("public");
    expect(pkg.publishConfig?.provenance).toBe(true);
  });

  it("sideEffects is false (pure ESM)", () => {
    expect(pkg.sideEffects).toBe(false);
  });

  it("ESLint + plugins are in devDependencies", () => {
    expect(pkg.devDependencies?.eslint).toBeTruthy();
    expect(pkg.devDependencies?.["@eslint/js"]).toBeTruthy();
  });

  it("engines.node requires >= 22.14 for npm Trusted Publishing", () => {
    expect(pkg.engines?.node).toMatch(/>=\s*22\.14/);
  });

  it("governance and onboarding files exist", () => {
    for (const rel of [
      "SECURITY.md",
      "CONTRIBUTING.md",
      "CODE_OF_CONDUCT.md",
      "CHANGELOG.md",
      "docs/install.md",
      "docs/troubleshooting.md",
      "docs/config.md",
      ".github/PULL_REQUEST_TEMPLATE.md",
      ".github/ISSUE_TEMPLATE/bug.yml",
      ".github/ISSUE_TEMPLATE/feature.yml"
    ]) {
      expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true);
    }
  });

  it("pack scripts do not write symlink backups inside adapter directories", () => {
    expect(pkg.scripts?.prepack).toContain("materialize-symlinks.mjs");
    expect(fs.readFileSync(path.join(ROOT, "scripts", "materialize-symlinks.mjs"), "utf8")).not.toContain(".symlink.bak");
  });
});

describe("M12.1 — redact.mjs covers 2026 vendor keys", () => {
  it("redacts modern OpenAI sk- key", () => {
    const r = redactText("OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz1234567890");
    expect(r.text).toContain("<chorus-redacted:openai_key");
  });

  it("redacts OpenAI sk-proj- project-scoped key", () => {
    const r = redactText("token: sk-proj-aBcDeFgHiJkLmNoPqRsTuVwXyZ_-1234567890abcdef");
    expect(r.text).toContain("<chorus-redacted:openai_key");
    expect(r.text).not.toContain("sk-proj");
  });

  it("redacts Anthropic sk-ant- key", () => {
    const r = redactText("X-API-Key: sk-ant-api03-aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890aBcDeFgHiJkLmNoPqRs");
    expect(r.text).toContain("<chorus-redacted:anthropic_key");
  });

  it("redacts Google API key (AIza…)", () => {
    const r = redactText("?key=AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R");
    expect(r.text).toContain("<chorus-redacted:google_api_key");
  });

  it("redacts Slack token", () => {
    const token = ["xoxb", "1234567890", "deadbeef0123456789abcdef"].join("-");
    const r = redactText(`Authorization: Bearer ${token}`);
    expect(r.text).toContain("<chorus-redacted:slack_token");
  });

  it("redacts a JWT-shaped string", () => {
    const r = redactText("jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");
    expect(r.text).toContain("<chorus-redacted:jwt");
  });

  it("redacts multiple secret types in one string with distinct placeholders", () => {
    const r = redactText("oa=sk-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA and an=sk-ant-api03-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(r.mapping.length).toBeGreaterThanOrEqual(2);
    const types = r.mapping.map((m) => m.type);
    expect(types).toContain("openai_key");
    expect(types).toContain("anthropic_key");
  });

  it("does NOT false-match generic words containing 'sk-'", () => {
    const r = redactText("the symbol is sk-letter");
    expect(r.text).toBe("the symbol is sk-letter");
  });
});

describe("M12.1 — eslint.config.mjs present + parseable", () => {
  it("eslint config file exists and exports a config array", async () => {
    const cfgPath = path.join(ROOT, "eslint.config.mjs");
    expect(fs.existsSync(cfgPath)).toBe(true);
    const mod = await import(cfgPath);
    expect(Array.isArray(mod.default)).toBe(true);
    expect(mod.default.length).toBeGreaterThan(0);
  });
});
