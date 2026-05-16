#!/usr/bin/env node
// Grok-format stub. Emits the single-JSON-object shape that
// `grok -p <prompt> --output-format json` produces.

import process from "node:process";
import fs from "node:fs";

const mode = process.env.CHORUS_STUB_MODE || "ok";

const stdinChunks = [];
process.stdin.on("data", (c) => stdinChunks.push(c));
process.stdin.on("end", () => run());

function emit(text) {
  process.stdout.write(
    JSON.stringify({
      text,
      stopReason: "EndTurn",
      sessionId: "ses_stub",
      requestId: "req_stub",
      thought: "stub thought"
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
