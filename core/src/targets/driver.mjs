/**
 * TargetDriver contract.
 *
 * Each target module under core/src/targets/ exports the same shape so
 * invoke.mjs and the runners stay target-agnostic.
 *
 * type TargetDriver = {
 *   id: "claude-code" | "codex" | "grok" | "opencode",
 *   runModes: Array<"subprocess" | "long-lived-server" | "in-process">,
 *   buildInvocation: (args: BuildArgs) => InvocationSpec,
 *   extractAssistant: (runResult: RunResult, mode: RunMode) => string,
 *   extractTokens: (runResult: RunResult, mode: RunMode) => { input, output, total },
 * }
 *
 * type BuildArgs = {
 *   mode: RunMode,
 *   prompt: string,
 *   model?: string,
 *   maxTokens?: number,
 *   schemaPath?: string,
 *   schemaId?: string,
 * }
 *
 * For mode === "subprocess", InvocationSpec is { command, args, stdin }.
 * Future modes will use different specs handled by their own runner.
 *
 * RunResult shape comes from the runner. For subprocess:
 *   { stdout: string, stderr: string, exitCode: number|null, ... }
 *
 * Drivers must NOT spawn processes themselves; that's the runner's job.
 * Drivers must NOT depend on logging, registry, or any other core module.
 */
export const SUBPROCESS = "subprocess";
