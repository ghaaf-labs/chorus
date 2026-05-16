# Review Diff

Runs a reviewer role against a small fixture patch. The script skips by
default; set `CHORUS_EXAMPLE_LIVE=1` to call real targets.

```bash
./run.sh
```

Expected shape: a Chorus envelope with `ok: true` and a reviewer result, or a
skip message when live targets are not enabled or unavailable.
