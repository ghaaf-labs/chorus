#!/usr/bin/env node
// Configurable stub for Codex used by e2e + sentinel tests.
// Reads prompt from stdin; emits one of several scripted behaviours.
//
// env CHORUS_STUB_MODE controls behaviour:
//   ok               (default) emit a valid reviewer-schema JSON
//   schema_violation emit JSON that doesn't match the reviewer schema
//   non_json         emit "not json at all"
//   overflow         emit > 6 MB of '{"x":1}\n' lines
//   sleep_forever    write nothing, sleep until killed
//   nonzero          write nothing, exit code 1 with stderr
//   sentinel         emit valid review JSON with a sentinel string baked in
//                    (use CHORUS_STUB_SENTINEL to set the string)
//
// The stub is intentionally vendor-agnostic. invoke.mjs's codex driver will
// still try to extract from this stdout via the codex JSONL format; for the
// `ok` and `sentinel` cases the stub emits a single line in that format.

import process from "node:process";
import fs from "node:fs";

const mode = process.env.CHORUS_STUB_MODE || "ok";

// Drain stdin so the parent's child.stdin.end() doesn't hang
const stdinChunks = [];
process.stdin.on("data", (c) => stdinChunks.push(c));
process.stdin.on("end", () => run());

function emitItemCompleted(text) {
  process.stdout.write(
    JSON.stringify({
      type: "item.completed",
      item: { id: "0", type: "agent_message", text }
    }) + "\n"
  );
  process.stdout.write(
    JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 100, output_tokens: 50 }
    }) + "\n"
  );
}

function validReview(summary = "stub review") {
  return JSON.stringify({
    verdict: "approve",
    summary,
    findings: [],
    next_steps: []
  });
}

function run() {
  switch (mode) {
    case "ok":
      emitItemCompleted(validReview());
      process.exit(0);
    case "sentinel": {
      const sentinel = process.env.CHORUS_STUB_SENTINEL || "CHORUS_TEST_SENTINEL_INNER";
      process.stderr.write(`stub diagnostic: ${sentinel}\n`);
      emitItemCompleted(validReview(`stub review (${sentinel})`));
      process.exit(0);
    }
    case "schema_violation":
      emitItemCompleted(JSON.stringify({ verdict: "maybe", summary: "" }));
      process.exit(0);
    case "non_json":
      emitItemCompleted("this is not json");
      process.exit(0);
    case "overflow": {
      // Node's stdout pipe is non-blocking when spawned. writeSync may write
      // fewer bytes than requested. Loop until the full chunk drains, then
      // repeat enough times to exceed the 4MB cap.
      const chunk = Buffer.from("x".repeat(65535) + "\n", "utf8");
      const totalChunks = 96;
      for (let i = 0; i < totalChunks; i++) {
        let written = 0;
        while (written < chunk.length) {
          try {
            written += fs.writeSync(1, chunk, written);
          } catch (e) {
            if (e.code === "EAGAIN") continue;
            if (e.code === "EPIPE") { process.exit(0); }
            throw e;
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
