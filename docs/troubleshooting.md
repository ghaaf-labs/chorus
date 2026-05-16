# Troubleshooting

Every failed call returns `ok: false`, an `error`, and usually a `hint`.

| Error | Diagnosis | Fix |
| --- | --- | --- |
| `timeout` | Target did not finish before the timeout | Increase `--timeout`, check target auth, or run the target CLI directly |
| `aborted` | Caller cancelled the operation | Re-run if cancellation was accidental |
| `budget_exceeded` | `~/.chorus/budget.json` blocked the estimate | Raise the ceiling, set `warn_only`, or use a cheaper model |
| `placeholder_leak` | Output contained an unexpected redaction placeholder | Treat as quarantine; inspect the payload sidecar locally |
| `stdout_overflow` | Target emitted more than `CHORUS_STDOUT_MAX_BYTES` | Raise the limit only for trusted targets |
| `schema_violation` | Target did not emit role-valid JSON | Inspect the payload sidecar and retry with a tighter task |
| `spawn_failed` | Binary could not start | Run `chorus doctor` and verify the target is installed |
| `nonzero_exit` | Target exited with a non-zero code | Read `stderr_excerpt`; re-run target CLI directly |
| `no_available_target` | No fallback target for the role is available | Install/auth a target and run `chorus setup` |
| `target_unavailable` | Requested target is missing or unauthenticated | Install/auth that target and run `chorus setup` |
| `target_not_implemented` | Driver is registered but not implemented | Use a supported target |
| `max_depth_exceeded` | Nested calls hit `CHORUS_MAX_DEPTH` | Simplify the chain or raise `CHORUS_MAX_DEPTH` deliberately |
| `cycle` | Source-target-role edge repeats in the same chain | Change role/target or break the recursion path |
| `self_target` | Source and target are identical | Pass `--allow-self` when intentional |
| `unsupported_mode` | Target does not support requested transport | Use `--mode subprocess` or remove `--mode` |
| `bad_quorum` | Council quorum is not valid `K-of-N` | Use a value like `2-of-3`; N must be <= distinct target count |
| `sequential_task` | Council refused a sequential task shape | Use `chorus call` or pass `--force` |
| `rag_canary_breach` | Retrieved content contained a canary token | Treat retrieval as poisoned; inspect source documents before retrying |

Useful commands:

```bash
chorus version
chorus setup
chorus doctor
chorus doctor --deep
chorus history --limit 10
chorus canary check
```
