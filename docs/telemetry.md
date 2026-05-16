# Telemetry

Chorus collects no telemetry by default.

There are no anonymous usage pings, crash beacons, first-run requests, or hosted
analytics. Local job logs are written so the user can inspect what happened on
their machine.

Observability is opt-in:

- Set `CHORUS_OTEL_FILE=/path/to/otel.jsonl` to write span-shaped JSONL.
- Set `CHORUS_OTEL_ENDPOINT=https://collector.example/v1/traces` to send
  OTLP/HTTP JSON.

Exported spans include `chorus.*` attributes and OpenTelemetry GenAI
attributes such as `gen_ai.request.model` and `gen_ai.usage.input_tokens`.
Prompt text and retrieved chunk text are not exported as OTel attributes.
