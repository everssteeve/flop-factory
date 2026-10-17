// Budget journalier de l'usine : enveloppes par atelier, ledger des coûts réels.
// Aucune dépendance externe. Toutes les sommes internes sont en USD, unité des
// coûts renvoyés par Claude Code (`total_cost_usd`).

import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

/** Plus petite enveloppe qui justifie de lancer un run (en USD). */
export const MIN_RUN_USD = 0.05;

export function loadConfig(root) {
  return JSON.parse(readFileSync(join(root, "factory", "config.json"), "utf8"));
}

/** Jour comptable 'YYYY-MM-DD' dans le fuseau de l'usine. */
export function dayKey(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function ledgerPath(root, day) {
  return join(root, "factory", "ledger", `${day}.json`);
}

export function readLedger(root, day) {
  const p = ledgerPath(root, day);
  if (!existsSync(p)) return { day, entries: [] };
  const data = JSON.parse(readFileSync(p, "utf8"));
  if (!Array.isArray(data.entries)) throw new Error(`ledger illisible : ${p}`);
  for (const e of data.entries) {
    if (typeof e?.atelier !== "string" || typeof e.usd !== "number" || !Number.isFinite(e.usd) || e.usd < 0) {
      throw new Error(`entrée de ledger invalide dans ${p} : ${JSON.stringify(e)}`);
    }
  }
  return data;
}

function assertAtelier(config, atelier) {
  if (!Object.hasOwn(config.budget.shares, atelier)) {
    throw new Error(`atelier inconnu : ${atelier}`);
  }
}

export function dailyUsd(config) {
  return config.budget.dailyEur * config.budget.usdPerEur;
}

export function allowanceUsd(config, atelier) {
  assertAtelier(config, atelier);
  return dailyUsd(config) * config.budget.shares[atelier];
}

export function spentUsd(ledger, atelier) {
  return ledger.entries
    .filter((e) => atelier === undefined || e.atelier === atelier)
    .reduce((sum, e) => sum + e.usd, 0);
}

/**
 * Ce qu'un run de l'atelier a le droit de dépenser maintenant.
 * Borné à la fois par l'enveloppe de l'atelier et par le total journalier.
 */
export function runCap(config, ledger, atelier) {
  const ownLeft = allowanceUsd(config, atelier) - spentUsd(ledger, atelier);
  const totalLeft = dailyUsd(config) - spentUsd(ledger);
  const left = Math.min(ownLeft, totalLeft);
  const cap = left * config.budget.perRunCapShare;
  return {
    remainingUsd: round(Math.max(0, left)),
    capUsd: cap >= MIN_RUN_USD ? round(cap) : 0,
    exhausted: cap < MIN_RUN_USD,
  };
}

/** Coût réel d'un résultat `claude -p --output-format json`. */
export function costFromResult(result) {
  const usd = result?.total_cost_usd;
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd < 0) {
    throw new Error("résultat sans total_cost_usd valide");
  }
  return usd;
}

export function record(root, day, entry) {
  if (typeof entry.usd !== "number" || !Number.isFinite(entry.usd) || entry.usd < 0) {
    throw new Error("coût invalide");
  }
  const ledger = readLedger(root, day);
  ledger.entries.push(entry);
  const p = ledgerPath(root, day);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(ledger, null, 2) + "\n");
  renameSync(tmp, p);
  return ledger;
}

function round(x) {
  return Math.round(x * 10000) / 10000;
}
