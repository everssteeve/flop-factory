import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateLedger, mergeRecords } from "../scripts/merge-records.mjs";
import { findLeaks } from "../scripts/leak-check.mjs";
import { guardConfirmed } from "../scripts/guard-smoke.mjs";
import { loadConfig } from "../scripts/lib/budget.mjs";

const repo = join(import.meta.dirname, "..");
const config = loadConfig(repo);
const entry = (o = {}) => ({ runId: "build-2026-10-17T10-00-00-000Z-abcdef12", atelier: "build", model: "haiku", usd: 0.04, status: "ok", at: "2026-10-17T10:00:00.000Z", ...o });

test("le ledger entrant doit prolonger celui du dépôt", () => {
  const base = { day: "2026-10-17", entries: [entry()] };
  assert.equal(validateLedger(config, base, { entries: [entry(), entry({ usd: 0.02 })] }).entries.length, 2);
  assert.throws(() => validateLedger(config, base, { entries: [] }), /perd/);
  assert.throws(() => validateLedger(config, base, { entries: [entry({ usd: 0 })] }), /réécrite/);
});

test("une entrée forgée est refusée", () => {
  const base = { day: "2026-10-17", entries: [] };
  for (const bad of [entry({ usd: -100 }), entry({ usd: "0" }), entry({ atelier: "x" }), entry({ status: "great" }), entry({ runId: "../x" }), { ...entry(), note: "hi" }]) {
    assert.throws(() => validateLedger(config, base, { entries: [bad] }), JSON.stringify(bad));
  }
});

test("mergeRecords fusionne et refuse les fichiers inattendus", () => {
  const root = mkdtempSync(join(tmpdir(), "ff-root-"));
  mkdirSync(join(root, "factory"), { recursive: true });
  cpSync(join(repo, "factory", "config.json"), join(root, "factory", "config.json"));
  const rec = mkdtempSync(join(tmpdir(), "ff-rec-"));
  mkdirSync(join(rec, "factory", "ledger"), { recursive: true });
  mkdirSync(join(rec, "factory", "runs", "2026-10-17"), { recursive: true });
  writeFileSync(join(rec, "factory", "ledger", "2026-10-17.json"), JSON.stringify({ entries: [entry()] }));
  writeFileSync(join(rec, "factory", "runs", "2026-10-17", `${entry().runId}.json`), "{}");
  writeFileSync(join(rec, "factory", "runs", "streaks.json"), JSON.stringify({ "build:p": 1 }));
  assert.equal(mergeRecords(root, rec).length, 3);
  assert.equal(JSON.parse(readFileSync(join(root, "factory", "ledger", "2026-10-17.json"), "utf8")).entries[0].usd, 0.04);
  writeFileSync(join(rec, "factory", "runs", "evil.sh"), "x");
  assert.throws(() => mergeRecords(root, rec), /inattendue/);
});

test("la clé est retrouvée en clair et encodée", () => {
  const key = "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const make = (content) => {
    const d = mkdtempSync(join(tmpdir(), "ff-leak-"));
    writeFileSync(join(d, "index.html"), content);
    return d;
  };
  assert.equal(findLeaks(make("<p>bonjour</p>"), key).length, 0);
  assert.equal(findLeaks(make(key), key).length, 1);
  assert.equal(findLeaks(make(Buffer.from(key).toString("base64")), key).length, 1);
  assert.equal(findLeaks(make(Buffer.from(key).toString("hex")), key).length, 1);
  assert.equal(findLeaks(make([...key].reverse().join("")), key).length, 1);
  assert.equal(findLeaks(make(`"${key.slice(0, 20)}" + "${key.slice(20)}"`), key).length, 1);
});

test("guard-smoke exige les deux refus attendus", () => {
  const d = (command) => ({ tool_name: "Bash", tool_input: { command } });
  assert.equal(guardConfirmed([d("printenv"), d("git push origin main")]), true);
  assert.equal(guardConfirmed([d("printenv"), d("printenv")]), false);
  assert.equal(guardConfirmed([]), false);
  assert.equal(guardConfirmed(undefined), false);
});
