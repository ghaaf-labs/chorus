# Observability Setup

Chorus emits spans only when configured.

## Local JSONL

```bash
CHORUS_OTEL_FILE=~/.chorus/otel.jsonl chorus call --role reviewer --task "Review this"
```

Each line is one span with `chorus.*` and `gen_ai.*` attributes.

## OTLP/HTTP

```bash
CHORUS_OTEL_ENDPOINT=http://localhost:4318/v1/traces \
  chorus call --role researcher --task "Summarize the release risks"
```

Use `CHORUS_OTEL_AUTH='Bearer ...'` when your collector needs an
Authorization header.

Honeycomb, Phoenix, Langfuse, and OpenTelemetry Collector can receive this path
through their OTLP/HTTP ingestion endpoints. Keep endpoint-specific API keys in
the environment; do not put them in tasks or config files.
