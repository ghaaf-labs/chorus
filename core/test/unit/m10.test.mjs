import { describe, it, expect } from "vitest";
import * as grokBuild from "../../src/targets/grok-build.mjs";
import * as copilot from "../../src/targets/copilot.mjs";
import { SUBPROCESS, ACP } from "../../src/targets/driver.mjs";
import { defaultTargetOrder, ROLE_NAMES } from "../../src/roles/defaults.mjs";

describe("grok-build driver shape", () => {
  it("declares id and ACP first in runModes", () => {
    expect(grokBuild.id).toBe("grok-build");
    expect(grokBuild.runModes[0]).toBe(ACP);
  });

  it("ACP spec spawns 'grok build agent stdio' with optional GROK_MODEL env", () => {
    const s = grokBuild.buildInvocation({ mode: ACP, prompt: "hi", model: "grok-4" });
    expect(s.command).toBe("grok");
    expect(s.args).toEqual(["build", "agent", "stdio"]);
    expect(s.env).toEqual({ GROK_MODEL: "grok-4" });
  });

  it("subprocess spec uses the build subcommand", () => {
    const s = grokBuild.buildInvocation({ mode: SUBPROCESS, prompt: "hi" });
    expect(s.args).toEqual(expect.arrayContaining(["build", "-p", "hi", "--output-format", "json", "--max-subagents", "4"]));
  });

  it("extractAssistant handles ACP and falls back on subprocess parse failure", () => {
    expect(grokBuild.extractAssistant({ stdout: "raw text" }, ACP)).toBe("raw text");
    expect(grokBuild.extractAssistant({ stdout: '{"text":"hi"}' }, SUBPROCESS)).toBe("hi");
    expect(grokBuild.extractAssistant({ stdout: "not json" }, SUBPROCESS)).toBe("not json");
  });
});

describe("copilot driver shape", () => {
  it("declares ACP as default", () => {
    expect(copilot.runModes[0]).toBe(ACP);
  });

  it("ACP spec spawns 'copilot acp' with COPILOT_MODEL", () => {
    const s = copilot.buildInvocation({ mode: ACP, prompt: "hi", model: "copilot-coding" });
    expect(s.command).toBe("copilot");
    expect(s.args).toEqual(["acp"]);
    expect(s.env).toEqual({ COPILOT_MODEL: "copilot-coding" });
  });

  it("subprocess spec includes --allow-all-tools", () => {
    const s = copilot.buildInvocation({ mode: SUBPROCESS, prompt: "hi" });
    expect(s.args).toContain("--allow-all-tools");
  });

  it("extractAssistant unpacks Copilot CLI response shape", () => {
    expect(copilot.extractAssistant({ stdout: '{"response":"hi"}' }, SUBPROCESS)).toBe("hi");
    expect(copilot.extractAssistant({ stdout: '{"text":"alt"}' }, SUBPROCESS)).toBe("alt");
  });
});

describe("ROLE_FALLBACKS includes new targets", () => {
  it("reviewer prefers grok-build over grok", () => {
    const order = defaultTargetOrder("reviewer");
    expect(order.indexOf("grok-build")).toBeLessThan(order.indexOf("grok"));
  });

  it("refactor-scribe role exists with copilot first", () => {
    expect(ROLE_NAMES).toContain("refactor-scribe");
    expect(defaultTargetOrder("refactor-scribe")[0]).toBe("copilot");
  });
});
