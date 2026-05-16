import { describe, it, expect } from "vitest";
import * as claude from "../../src/targets/claude.mjs";
import * as codex from "../../src/targets/codex.mjs";
import { SUBPROCESS } from "../../src/targets/driver.mjs";

describe("targets/claude driver shape", () => {
  it("declares id and runModes", () => {
    expect(claude.id).toBe("claude-code");
    expect(claude.runModes).toContain(SUBPROCESS);
  });

  it("buildInvocation returns documented argv", () => {
    const s = claude.buildInvocation({ mode: SUBPROCESS, prompt: "hi", model: "claude-sonnet-4-7" });
    expect(s.command).toBe("claude");
    expect(s.args).toContain("-p");
    expect(s.args).toContain("--no-session-persistence");
    expect(s.args).toContain("--disable-slash-commands");
    expect(s.args).toContain("--output-format");
    expect(s.args).toContain("json");
    expect(s.args).toContain("--model");
    expect(s.args).toContain("claude-sonnet-4-7");
    expect(s.stdin).toBe("hi");
  });

  it("omits --model when not passed", () => {
    const s = claude.buildInvocation({ mode: SUBPROCESS, prompt: "hi" });
    expect(s.args).not.toContain("--model");
  });

  it("inlines the schema text via --json-schema when schemaPath is given", () => {
    const schemaPath = new URL("../../src/schemas/reviewer.schema.json", import.meta.url).pathname;
    const s = claude.buildInvocation({ mode: SUBPROCESS, prompt: "hi", schemaPath });
    expect(s.args).toContain("--json-schema");
    const idx = s.args.indexOf("--json-schema");
    const schemaArg = s.args[idx + 1];
    expect(schemaArg).toContain("verdict");
    expect(schemaArg).toContain("findings");
  });

  it("buildInvocation throws on unsupported mode", () => {
    expect(() => claude.buildInvocation({ mode: "long-lived-server", prompt: "hi" })).toThrow();
  });
});

describe("targets/codex driver shape", () => {
  it("declares id and runModes", () => {
    expect(codex.id).toBe("codex");
    expect(codex.runModes).toContain(SUBPROCESS);
  });

  it("buildInvocation builds exec + json + schema + model + stdin marker", () => {
    const s = codex.buildInvocation({
      mode: SUBPROCESS,
      prompt: "hi",
      model: "gpt-5.4-mini",
      schemaPath: "/tmp/s.json"
    });
    expect(s.command).toBe("codex");
    expect(s.args[0]).toBe("exec");
    expect(s.args).toContain("--json");
    expect(s.args).toContain("--ephemeral");
    expect(s.args).toContain("--output-schema");
    expect(s.args).toContain("/tmp/s.json");
    expect(s.args).toContain("--model");
    expect(s.args).toContain("gpt-5.4-mini");
    expect(s.args[s.args.length - 1]).toBe("-");
    expect(s.stdin).toBe("hi");
  });

  it("defaults to read-only sandbox", () => {
    const s = codex.buildInvocation({ mode: SUBPROCESS, prompt: "hi" });
    expect(s.args).toContain("--sandbox");
    expect(s.args).toContain("read-only");
  });
});

describe("targets/codex.extractAssistant", () => {
  it("pulls item.completed.agent_message text (codex 0.130+ schema)", () => {
    const stdout = [
      '{"type":"thread.started","thread_id":"x"}',
      '{"type":"item.completed","item":{"id":"0","type":"agent_message","text":"final answer"}}',
      '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":2}}'
    ].join("\n");
    expect(codex.extractAssistant({ stdout }, SUBPROCESS)).toBe("final answer");
  });

  it("handles legacy msg.agent_message shape", () => {
    const stdout = '{"msg":{"type":"agent_message","message":"legacy"}}';
    expect(codex.extractAssistant({ stdout }, SUBPROCESS)).toBe("legacy");
  });
});

describe("targets/codex.extractTokens", () => {
  it("reads usage from turn.completed", () => {
    const stdout = '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":50}}';
    const t = codex.extractTokens({ stdout }, SUBPROCESS);
    expect(t.input).toBe(100);
    expect(t.output).toBe(50);
    expect(t.total).toBe(150);
  });
});
