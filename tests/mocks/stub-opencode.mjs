#!/usr/bin/env node
// OpenCode-format stub. Emits JSONL events matching `opencode run --format json`.
// Honors CHORUS_STUB_MODE (same vocabulary as stub-codex.mjs / stub-claude.mjs).

import process from "node:process";
import fs from "node:fs";

const mode = process.env.CHORUS_STUB_MODE || "ok";

const stdinChunks = [];
process.stdin.on("data", (c) => stdinChunks.push(c));
process.stdin.on("end", () => run());

function emit(text) {
  process.stdout.write(
    JSON.stringify({
      type: "text",
      sessionID: "ses_stub",
      part: { type: "text", text, time: { start: 1, end: 2 } }
    }) + "\n"
  );
  process.stdout.write(
    JSON.stringify({
      type: "step_finish",
      sessionID: "ses_stub",
      part: { type: "step-finish", tokens: { input: 100, output: 50, total: 150 }, cost: 0.001 }
    }) + "\n"
  );
}

function validReview() {
  return JSON.stringify({ verdict: "approve", summary: "stub review", findings: [], next_steps: [] });
}

function run() {
  switch (mode) {
    case "ok":
      emit(validReview());
      process.exit(0);
    case "schema_violation":
      emit(JSON.stringify({ verdict: "maybe", summary: "" }));
      process.exit(0);
    case "non_json":
      emit("not json");
      process.exit(0);
    case "overflow": {
      const chunk = Buffer.from("x".repeat(65535) + "\n", "utf8");
      for (let i = 0; i < 96; i++) {
        let written = 0;
        while (written < chunk.length) {
          try { written += fs.writeSync(1, chunk, written); }
          catch (e) {
            if (e.code === "EAGAIN") continue;
            process.exit(0);
          }
        }
      }
      process.exit(0);
    }
    case "sleep_forever":
      setInterval(() => {}, 1000);
      break;
    case "nonzero":
      process.stderr.write("stub failure\n");
      process.exit(1);
    default:
      process.stderr.write(`unknown stub mode: ${mode}\n`);
      process.exit(2);
  }
}
