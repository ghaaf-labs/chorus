/**
 * OpenTelemetry-shaped JSONL emitter for Chorus calls.
 *
 * Wire format aligns with OTel trace span semantics so the file can be
 * piped into otel-cli, vector, or a JSONL→OTLP shim. We don't take a
 * dependency on @opentelemetry/* to keep Chorus zero-dep at runtime.
 *
 * Enabled by CHORUS_OTEL_FILE=<path> (preferred) or CHORUS_OTEL_ENDPOINT
 * (currently writes to ~/.chorus/otel.jsonl when set; HTTP/gRPC export
 * is post-M9).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

function defaultFile() {
  return path.join(os.homedir(), ".chorus", "otel.jsonl");
}

function targetFile() {
  if (process.env.CHORUS_OTEL_FILE) return process.env.CHORUS_OTEL_FILE;
  if (process.env.CHORUS_OTEL_ENDPOINT) return defaultFile();
  return null;
}

function hex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

export function newTraceContext() {
  return { trace_id: hex(16), span_id: hex(8) };
}

export function emitSpan({ name, traceId, spanId, parentSpanId, startNs, endNs, attributes = {}, status = "OK", error }) {
  const file = targetFile();
  if (!file) return;
  const span = {
    name,
    trace_id: traceId,
    span_id: spanId,
    parent_span_id: parentSpanId ?? null,
    start_time_unix_nano: startNs,
    end_time_unix_nano: endNs,
    attributes,
    status: { code: error ? "ERROR" : status, ...(error ? { message: String(error) } : {}) },
    resource: { "service.name": "chorus", "service.version": "0.1.0" }
  };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(span) + "\n");
  } catch { /* ignore export errors — OTel is observability, not correctness */ }
}

export function nowNs() {
  return process.hrtime.bigint().toString();
}
