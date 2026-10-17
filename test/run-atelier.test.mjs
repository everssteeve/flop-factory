import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAtelier, pickModel, parseArgs } from "../scripts/run-atelier.mjs";
import { claudeArgs } from "../scripts/lib/claude-args.mjs";
import { loadConfig, readLedger, allowanceUsd } from "../scripts/lib/budget.mjs";

const repo = join(import.meta.dirname, "..");
const NOW = new Date("2026-10-17T10:00:00Z");
const DAY = "2026-10-17";
const OPTS = { atelier: "build", prompt: "factory/prompts/socle-hello.md", workdir: "work/hello" };

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), "ff-run-"));
  for (const p of ["factory/config.json", "factory/blocklist.json", "factory/prompts/socle-hello.md", "harness/overlay/RUN-RULES.md", "harness/overlay/run-settings.json"]) {
    mkdirSync(join(root, p, ".."), { recursive: true });
    cpSync(join(repo, p), join(root, p));
  }
  return root;
}

/** Faux `claude` : écrit éventuellement report.json et renvoie un JSON donné. */
function fakeClaude({ stdout, status = 0, report }) {
  const calls = [];
  const spawn = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    if (report) writeFileSync(join(options.cwd, "report.json"), JSON.stringify(report));
    return { status, stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout), stderr: "" };
  };
  return { spawn, calls };
}

test("un run réussi note son coût réel, son journal et remet la série à zéro", () => {
  const root = tempRoot();
  const fake = fakeClaude({ stdout: { total_cost_usd: 0.042, is_error: false, num_turns: 7, subtype: "success" }, report: { status: "ok" } });
  const out = runAtelier(OPTS, { root, now: NOW, spawn: fake.spawn, env: { PATH: "/bin", ANTHROPIC_API_KEY: "k" } });
  assert.equal(out.status, "ok");
  assert.equal(out.model, "haiku");
  const ledger = readLedger(root, DAY);
  assert.equal(ledger.entries.length, 1);
  assert.equal(ledger.entries[0].usd, 0.042);
  const logs = readdirSync(join(root, "factory", "runs", DAY));
  assert.equal(logs.length, 1);
  assert.equal(JSON.parse(readFileSync(join(root, "factory", "runs", DAY, logs[0]), "utf8")).numTurns, 7);
});

test("le run ne reçoit que la clé API, aucun autre secret", () => {
  const root = tempRoot();
  const fake = fakeClaude({ stdout: { total_cost_usd: 0.01 }, report: { status: "ok" } });
  runAtelier(OPTS, { root, now: NOW, spawn: fake.spawn, env: { PATH: "/bin", HOME: "/h", ANTHROPIC_API_KEY: "k", VERCEL_TOKEN: "v", GITHUB_TOKEN: "g" } });
  const env = fake.calls[0].options.env;
  assert.equal(env.ANTHROPIC_API_KEY, "k");
  assert.equal(env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, "1");
  assert.equal(env.VERCEL_TOKEN, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
});

test("un résultat illisible compte le plafond entier et un échec", () => {
  const root = tempRoot();
  const fake = fakeClaude({ stdout: "plantage", status: 1 });
  const out = runAtelier(OPTS, { root, now: NOW, spawn: fake.spawn, env: {} });
  assert.equal(out.status, "failed");
  const cap = Number(fake.calls[0].args[fake.calls[0].args.indexOf("--max-budget-usd") + 1]);
  assert.ok(Math.abs(readLedger(root, DAY).entries[0].usd - cap) < 0.01);
});

test("sans report.json ok, le run est un échec même si Claude sort à 0", () => {
  const root = tempRoot();
  const fake = fakeClaude({ stdout: { total_cost_usd: 0.02 }, report: { status: "failed" } });
  assert.equal(runAtelier(OPTS, { root, now: NOW, spawn: fake.spawn, env: {} }).status, "failed");
});

test("deux échecs de suite font passer le run suivant à Sonnet", () => {
  const root = tempRoot();
  const fail = fakeClaude({ stdout: { total_cost_usd: 0.01, is_error: true } });
  runAtelier(OPTS, { root, now: NOW, spawn: fail.spawn, env: {} });
  runAtelier(OPTS, { root, now: NOW, spawn: fail.spawn, env: {} });
  const ok = fakeClaude({ stdout: { total_cost_usd: 0.01 }, report: { status: "ok" } });
  assert.equal(runAtelier(OPTS, { root, now: NOW, spawn: ok.spawn, env: {} }).model, "sonnet");
  // la réussite remet la série à zéro
  assert.equal(runAtelier(OPTS, { root, now: NOW, spawn: ok.spawn, env: {} }).model, "haiku");
});

test("le fichier STOP arrête tout sans appeler Claude", () => {
  const root = tempRoot();
  writeFileSync(join(root, "STOP"), "");
  const fake = fakeClaude({ stdout: {} });
  assert.equal(runAtelier(OPTS, { root, now: NOW, spawn: fake.spawn, env: {} }).status, "stopped");
  assert.equal(fake.calls.length, 0);
});

test("une enveloppe vide n'appelle pas Claude", () => {
  const root = tempRoot();
  const config = loadConfig(root);
  mkdirSync(join(root, "factory", "ledger"), { recursive: true });
  writeFileSync(join(root, "factory", "ledger", `${DAY}.json`), JSON.stringify({ day: DAY, entries: [{ atelier: "build", usd: allowanceUsd(config, "build") }] }));
  const fake = fakeClaude({ stdout: {} });
  assert.equal(runAtelier(OPTS, { root, now: NOW, spawn: fake.spawn, env: {} }).status, "no-budget");
  assert.equal(fake.calls.length, 0);
});

test("les règles du run embarquent la liste des sujets interdits", () => {
  const root = tempRoot();
  const fake = fakeClaude({ stdout: { total_cost_usd: 0.01 }, report: { status: "ok" } });
  runAtelier(OPTS, { root, now: NOW, spawn: fake.spawn, env: {} });
  const args = fake.calls[0].args;
  const rules = readFileSync(args[args.indexOf("--append-system-prompt-file") + 1], "utf8");
  assert.match(rules, /Sujets interdits/);
  assert.match(rules, /jeux d'argent/);
});

test("la ligne de commande borne toujours le run", () => {
  const args = claudeArgs({ prompt: "x", model: "haiku", capUsd: 0.5, maxTurns: 10, pluginDir: "/p", rulesFile: "/r", settingsFile: "/s" });
  for (const flag of ["--bare", "--max-budget-usd", "--max-turns", "--permission-prompts", "--plugin-dir", "--no-session-persistence", "--settings", "--tools"]) {
    assert.ok(args.includes(flag), flag);
  }
  assert.equal(args[args.indexOf("--permission-mode") + 1], "dontAsk");
  assert.ok(!args.includes("--dangerously-skip-permissions"));
  assert.throws(() => claudeArgs({ prompt: "x", model: "haiku", capUsd: 0, maxTurns: 10, settingsFile: "/s" }), /plafond/);
  assert.throws(() => claudeArgs({ prompt: "x", model: "haiku", capUsd: 1, maxTurns: 0, settingsFile: "/s" }), /tours/);
  assert.throws(() => claudeArgs({ prompt: "x", model: "haiku", capUsd: 1, maxTurns: 5 }), /sandbox/);
});

test("pickModel et parseArgs", () => {
  const config = loadConfig(repo);
  assert.equal(pickModel(config, "cerveau", 0), "sonnet");
  assert.equal(pickModel(config, "build", 1), "haiku");
  assert.equal(pickModel(config, "build", 0, "sonnet"), "sonnet");
  assert.deepEqual(parseArgs(["--atelier", "build", "--prompt", "p", "--workdir", "w"]), { atelier: "build", prompt: "p", workdir: "w" });
  assert.throws(() => parseArgs(["--atelier", "build"]), /manquant/);
});

test("avec --records, le dépôt n'est jamais écrit et le ledger repart de son état", () => {
  const root = tempRoot();
  mkdirSync(join(root, "factory", "ledger"), { recursive: true });
  writeFileSync(join(root, "factory", "ledger", `${DAY}.json`), JSON.stringify({ day: DAY, entries: [{ atelier: "build", usd: 0.1 }] }));
  const records = mkdtempSync(join(tmpdir(), "ff-rec-"));
  const fake = fakeClaude({ stdout: { total_cost_usd: 0.03 }, report: { status: "ok" } });
  runAtelier({ ...OPTS, records }, { root, now: NOW, spawn: fake.spawn, env: {} });
  runAtelier({ ...OPTS, records }, { root, now: NOW, spawn: fake.spawn, env: {} });
  assert.equal(readLedger(root, DAY).entries.length, 1);
  const out = readLedger(records, DAY).entries;
  assert.deepEqual(out.map((e) => e.usd), [0.1, 0.03, 0.03]);
  assert.equal(readdirSync(join(records, "factory", "runs", DAY)).length, 2);
});

test("un run tué par le délai compte le plafond entier", () => {
  const root = tempRoot();
  const spawn = (cmd, args) => ({ status: null, stdout: "", stderr: "", error: Object.assign(new Error("t"), { code: "ETIMEDOUT" }), args });
  const out = runAtelier(OPTS, { root, now: NOW, spawn, env: {} });
  assert.equal(out.status, "failed");
  assert.ok(readLedger(root, DAY).entries[0].usd > 0);
});
