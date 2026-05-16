#!/usr/bin/env node
// Claude-format stub. Emits the JSON envelope shape that `claude -p --output-format json` produces.
// Same CHORUS_STUB_MODE controls as stub-codex.mjs.

import process from "node:process";
import fs from "node:fs";

const mode = process.env.CHORUS_STUB_MODE || "ok";

const stdinChunks = [];
process.stdin.on("data", (c) => stdinChunks.push(c));
process.stdin.on("end", () => run());

function emit(text) {
  process.stdout.write(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 100,
      result: text,
      usage: { input_tokens: 100, output_tokens: 50 }
    })
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
      emit("not json at all");
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
