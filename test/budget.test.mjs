import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConfig, dayKey, readLedger, runCap, record, allowanceUsd, dailyUsd, costFromResult, MIN_RUN_USD,
} from "../scripts/lib/budget.mjs";

const repo = join(import.meta.dirname, "..");

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), "ff-budget-"));
  mkdirSync(join(root, "factory"), { recursive: true });
  cpSync(join(repo, "factory", "config.json"), join(root, "factory", "config.json"));
  return root;
}

test("les parts des ateliers font 100 %", () => {
  const shares = Object.values(loadConfig(repo).budget.shares);
  assert.ok(Math.abs(shares.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test("le jour comptable suit le fuseau de Paris, pas UTC", () => {
  // 23h30 UTC le 17 = 01h30 à Paris le 18 (heure d'été)
  assert.equal(dayKey(new Date("2026-10-17T23:30:00Z"), "Europe/Paris"), "2026-10-18");
  assert.equal(dayKey(new Date("2026-10-17T21:30:00Z"), "Europe/Paris"), "2026-10-17");
});

test("un ledger vide laisse l'enveloppe entière de l'atelier", () => {
  const config = loadConfig(repo);
  const cap = runCap(config, { entries: [] }, "build");
  assert.equal(cap.remainingUsd, Math.round(allowanceUsd(config, "build") * 1e4) / 1e4);
  assert.equal(cap.exhausted, false);
  assert.ok(cap.capUsd <= cap.remainingUsd * config.budget.perRunCapShare + 1e-9);
});

test("une enveloppe consommée bloque l'atelier", () => {
  const config = loadConfig(repo);
  const ledger = { entries: [{ atelier: "run", usd: allowanceUsd(config, "run") }] };
  const cap = runCap(config, ledger, "run");
  assert.equal(cap.exhausted, true);
  assert.equal(cap.capUsd, 0);
});

test("le total journalier borne même un atelier qui a encore sa part", () => {
  const config = loadConfig(repo);
  const ledger = { entries: [{ atelier: "cerveau", usd: dailyUsd(config) }] };
  assert.equal(runCap(config, ledger, "build").exhausted, true);
});

test("un reliquat sous le minimum compte comme épuisé", () => {
  const config = loadConfig(repo);
  const left = MIN_RUN_USD / 2 / config.budget.perRunCapShare;
  const ledger = { entries: [{ atelier: "gtm", usd: allowanceUsd(config, "gtm") - left }] };
  assert.equal(runCap(config, ledger, "gtm").exhausted, true);
});

test("un atelier inconnu est refusé", () => {
  assert.throws(() => runCap(loadConfig(repo), { entries: [] }, "marketing"), /atelier inconnu/);
});

test("record ajoute au ledger du jour et refuse un coût invalide", () => {
  const root = tempRoot();
  record(root, "2026-10-17", { atelier: "build", usd: 0.12 });
  record(root, "2026-10-17", { atelier: "build", usd: 0.08 });
  assert.equal(readLedger(root, "2026-10-17").entries.length, 2);
  assert.equal(readLedger(root, "2026-10-18").entries.length, 0);
  assert.throws(() => record(root, "2026-10-17", { atelier: "build", usd: -1 }), /coût invalide/);
  assert.throws(() => record(root, "2026-10-17", { atelier: "build", usd: NaN }), /coût invalide/);
});

test("costFromResult exige un total_cost_usd numérique", () => {
  assert.equal(costFromResult({ total_cost_usd: 0.031 }), 0.031);
  assert.throws(() => costFromResult({}), /total_cost_usd/);
  assert.throws(() => costFromResult(null), /total_cost_usd/);
  assert.throws(() => costFromResult({ total_cost_usd: "0.03" }), /total_cost_usd/);
});
