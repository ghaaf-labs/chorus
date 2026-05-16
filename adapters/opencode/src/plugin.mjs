// Chorus OpenCode plugin entrypoint.
//
// The active surface today is the four chorus-* subagents in
// adapters/opencode/agents/. They shell out to the `chorus` CLI via the Bash
// tool, so this plugin module is a minimal scaffold: it identifies itself and
// can be extended later with custom OpenCode tools (chorus_call,
// chorus_council) for in-process delegation that bypasses the CLI wrapper.

export default async function chorusPlugin(_opencode) {
  return {
    event: async ({ event }) => {
      if (event?.type === "server.connected") {
        // No-op: log point for future telemetry / setup checks.
      }
    }
  };
}
