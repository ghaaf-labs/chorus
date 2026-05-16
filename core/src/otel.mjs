/**
 * OpenTelemetry-shaped JSONL emitter for Chorus calls.
 *
 * Wire format aligns with OTel trace span semantics so the file can be
 * piped into otel-cli, vector, or a JSONL→OTLP shim. We don't take a
 * dependency on @opentelemetry/* to keep Chorus zero-dep at runtime.
 *
 * Enabled by CHORUS_OTEL_FILE=<path> and/or CHORUS_OTEL_ENDPOINT=<http(s) URL>.
 * The file sink is JSONL for local debugging; the endpoint sink sends
 * OTLP/HTTP JSON directly with fetch().
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function hex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

export function newTraceContext() {
  return { trace_id: hex(16), span_id: hex(8) };
}

export async function emitSpan({ name, traceId, spanId, parentSpanId, startNs, endNs, attributes = {}, status = "OK", error }) {
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
  const writes = [];
  if (process.env.CHORUS_OTEL_FILE) writes.push(writeJsonl(process.env.CHORUS_OTEL_FILE, span));
  if (process.env.CHORUS_OTEL_ENDPOINT) writes.push(postOtlp(process.env.CHORUS_OTEL_ENDPOINT, span));
  await Promise.allSettled(writes);
}

function writeJsonl(file, span) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(span) + "\n");
  } catch { /* ignore export errors — OTel is observability, not correctness */ }
}

async function postOtlp(endpoint, span) {
  if (!/^https?:\/\//i.test(endpoint)) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.parseInt(process.env.CHORUS_OTEL_TIMEOUT_MS ?? "3000", 10));
  try {
    await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.CHORUS_OTEL_AUTH ? { authorization: process.env.CHORUS_OTEL_AUTH } : {})
      },
      body: JSON.stringify(toOtlpJson(span)),
      signal: controller.signal
    });
  } catch { /* ignore export errors — OTel is observability, not correctness */ }
  finally {
    clearTimeout(timeout);
  }
}

function attrValue(v) {
  if (typeof v === "boolean") return { boolValue: v };
  if (typeof v === "number" && Number.isFinite(v)) {
    return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  }
  return { stringValue: String(v ?? "") };
}

function attrs(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([key, value]) => ({ key, value: attrValue(value) }));
}

function toOtlpJson(span) {
  return {
    resourceSpans: [{
      resource: { attributes: attrs(span.resource) },
      scopeSpans: [{
        scope: { name: "chorus" },
        spans: [{
          traceId: span.trace_id,
          spanId: span.span_id,
          ...(span.parent_span_id ? { parentSpanId: span.parent_span_id } : {}),
          name: span.name,
          kind: 1,
          startTimeUnixNano: span.start_time_unix_nano,
          endTimeUnixNano: span.end_time_unix_nano,
          attributes: attrs(span.attributes),
          status: { code: span.status.code === "ERROR" ? 2 : 1, ...(span.status.message ? { message: span.status.message } : {}) }
        }]
      }]
    }]
  };
}

export function nowNs() {
  return process.hrtime.bigint().toString();
}
