import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import { runInitWizard } from "../../src/init/wizard.mjs";

let savedHome;
let tmpHome;

class Capture extends Writable {
  constructor() {
    super();
    this.text = "";
  }
  _write(chunk, _encoding, callback) {
    this.text += chunk.toString("utf8");
    callback();
  }
}

const TEST_PROBE = { node: process.version, platform: "test/test", hosts: {}, available: [] };

beforeEach(() => {
  savedHome = process.env.HOME;
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-init-"));
  process.env.HOME = tmpHome;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("init wizard", () => {
  it("creates a 0600 budget template in --yes mode", async () => {
    const output = new Capture();
    const result = await runInitWizard({ output, yes: true, probe: TEST_PROBE });
    const budget = path.join(tmpHome, ".chorus", "budget.json");
    expect(result.ok).toBe(true);
    expect(fs.existsSync(budget)).toBe(true);
    expect(JSON.parse(fs.readFileSync(budget, "utf8")).daily_usd).toBe(5);
    expect((fs.statSync(budget).mode & 0o777)).toBe(0o600);
    expect(output.text).toContain("chorus doctor");
  });

  it("keeps an existing budget file", async () => {
    const dir = path.join(tmpHome, ".chorus");
    fs.mkdirSync(dir, { recursive: true });
    const budget = path.join(dir, "budget.json");
    fs.writeFileSync(budget, JSON.stringify({ daily_usd: 1 }));
    const output = new Capture();
    await runInitWizard({ output, yes: true, probe: TEST_PROBE });
    expect(JSON.parse(fs.readFileSync(budget, "utf8")).daily_usd).toBe(1);
    expect(output.text).toContain("kept existing");
  });
});
