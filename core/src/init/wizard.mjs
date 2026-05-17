import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import { probeInstall } from "./probe.mjs";
import { installAll, summarizeForDisplay } from "../install/index.mjs";

const DEFAULT_BUDGET = {
  daily_usd: 5,
  per_call_usd: 0.5,
  per_council_usd: 2,
  warn_only: false
};

function chorusDir() {
  return path.join(os.homedir(), ".chorus");
}

function budgetPath() {
  return path.join(chorusDir(), "budget.json");
}

function writeLine(output, text = "") {
  output.write(text + "\n");
}

async function ask(rl, question, fallback = "y") {
  const answer = (await rl.question(question)).trim().toLowerCase();
  return answer || fallback;
}

export async function runInitWizard({
  input = defaultInput,
  output = defaultOutput,
  yes = false,
  probe: providedProbe,
  installer = installAll,
  skipInstall = false
} = {}) {
  const probe = providedProbe ?? probeInstall();
  await fsp.mkdir(chorusDir(), { recursive: true, mode: 0o700 });

  writeLine(output, "chorus init");
  writeLine(output, `node: ${probe.node}`);
  writeLine(output, `platform: ${probe.platform}`);
  writeLine(output, "");
  writeLine(output, "targets:");
  for (const [name, info] of Object.entries(probe.hosts)) {
    writeLine(output, `  ${name.padEnd(14)} ${info.available ? "available" : `missing (${info.reason || "not_installed"})`}`);
  }

  const existingBudget = fs.existsSync(budgetPath());
  let createBudget = yes || !existingBudget;
  let runKnowledgeHint = false;
  let registerPlugins = yes;
  let rl;

  if (!yes && input.isTTY !== false) {
    rl = readline.createInterface({ input, output });
    try {
      if (!existingBudget) {
        createBudget = (await ask(rl, "\nCreate ~/.chorus/budget.json with safe defaults? [Y/n] ", "y")) !== "n";
      }
      registerPlugins = (await ask(rl, "Register Chorus as a plugin for available hosts (claude/codex/grok/opencode)? [Y/n] ", "y")) !== "n";
      runKnowledgeHint = (await ask(rl, "Print optional Knowledge Index bootstrap commands? [y/N] ", "n")) === "y";
    } finally {
      rl.close();
    }
  }

  if (createBudget && !existingBudget) {
    await fsp.writeFile(budgetPath(), JSON.stringify(DEFAULT_BUDGET, null, 2) + "\n", { mode: 0o600 });
    writeLine(output, `\nwrote ${budgetPath()}`);
  } else if (existingBudget) {
    writeLine(output, `\nkept existing ${budgetPath()}`);
  }

  let installResults = null;
  let installErrors = 0;
  if (registerPlugins && !skipInstall) {
    writeLine(output, "\nregistering plugins:");
    installResults = installer({ probe: probe.hosts, mode: "copy" });
    writeLine(output, summarizeForDisplay(installResults));
    installErrors = installResults.filter((r) => r.status === "error").length;
    if (installErrors > 0) {
      writeLine(output, `\n${installErrors} host(s) failed to register — re-run with \`chorus install --force\` or fix the conflict above`);
    }
  } else if (!registerPlugins) {
    writeLine(output, "\nskipped plugin registration — run `chorus install` to register later");
  }

  if (runKnowledgeHint || yes) {
    writeLine(output, "\noptional Knowledge Index bootstrap:");
    writeLine(output, "  cd ../tools/knowledge-index");
    writeLine(output, "  uv sync && uv run knowledge ingest && uv run knowledge index");
  }

  writeLine(output, "\nnext:");
  writeLine(output, "  chorus doctor");
  writeLine(output, "  chorus doctor --deep");
  return {
    ok: installErrors === 0,
    available: probe.available,
    budget_path: budgetPath(),
    budget_created: createBudget && !existingBudget,
    install_results: installResults,
    install_errors: installErrors
  };
}
