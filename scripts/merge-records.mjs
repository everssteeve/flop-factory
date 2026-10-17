#!/usr/bin/env node
// Fusionne dans le dépôt les écritures d'un job agent (ledger, journaux,
// séries d'échecs), après validation stricte. Exécuté dans un job séparé, sur
// un checkout neuf : rien de ce que l'agent a pu toucher ne s'exécute ici.
//
//   node scripts/merge-records.mjs <records-dir>

import { readFileSync, readdirSync, existsSync, statSync, cpSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, readLedger } from "./lib/budget.mjs";
import { loadIdeas, checkDiscovered } from "./lib/apps.mjs";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const RUN_ID = /^[a-z]+-[0-9TZ-]+-[0-9a-f]{8}$/;

/**
 * Valide le ledger d'un jour venu du job agent : il doit prolonger celui du
 * dépôt (mêmes premières entrées, dans le même ordre) et chaque nouvelle entrée
 * doit être bien formée. Renvoie le ledger à écrire.
 */
export function validateLedger(config, base, incoming) {
  if (!Array.isArray(incoming?.entries)) throw new Error("ledger entrant illisible");
  if (incoming.entries.length < base.entries.length) throw new Error("le ledger entrant perd des entrées");
  base.entries.forEach((e, i) => {
    if (JSON.stringify(e) !== JSON.stringify(incoming.entries[i])) throw new Error(`entrée ${i} réécrite`);
  });
  for (const e of incoming.entries.slice(base.entries.length)) {
    const keys = Object.keys(e).sort().join(",");
    if (keys !== "at,atelier,model,runId,status,usd") throw new Error(`champs inattendus : ${keys}`);
    if (!Object.hasOwn(config.budget.shares, e.atelier)) throw new Error(`atelier inconnu : ${e.atelier}`);
    if (typeof e.usd !== "number" || !Number.isFinite(e.usd) || e.usd < 0 || e.usd > 100) throw new Error(`coût invalide : ${e.usd}`);
    if (!RUN_ID.test(e.runId)) throw new Error(`runId invalide : ${e.runId}`);
    if (!["ok", "failed"].includes(e.status)) throw new Error(`statut invalide : ${e.status}`);
  }
  return { day: base.day, entries: incoming.entries };
}

/**
 * Idées découvertes venues du job agent : elles doivent prolonger le fichier
 * du dépôt, et chaque nouvelle idée repasse les filtres de l'usine.
 */
export function validateDiscovered(root, incoming, maxDiscovered) {
  const p = join(root, "factory", "ideas-discovered.json");
  const base = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")).ideas : [];
  if (!Array.isArray(incoming?.ideas)) throw new Error("idées découvertes illisibles");
  if (incoming.ideas.length < base.length || incoming.ideas.length > maxDiscovered) throw new Error("idées découvertes : longueur inattendue");
  base.forEach((e, i) => {
    if (JSON.stringify(e) !== JSON.stringify(incoming.ideas[i])) throw new Error(`idée découverte ${i} réécrite`);
  });
  const blocklist = JSON.parse(readFileSync(join(root, "factory", "blocklist.json"), "utf8"));
  const known = new Set(loadIdeas(root).map((i) => i.slug));
  for (const c of incoming.ideas.slice(base.length)) {
    const problems = checkDiscovered(c, known, blocklist);
    if (problems.length) throw new Error(`idée découverte refusée (${c?.slug}) : ${problems.join(", ")}`);
    known.add(c.slug);
  }
  return { ideas: incoming.ideas };
}

export function mergeRecords(root, records) {
  const config = loadConfig(root);
  const merged = [];
  const ip = join(records, "factory", "ideas-discovered.json");
  if (existsSync(ip)) {
    const next = validateDiscovered(root, JSON.parse(readFileSync(ip, "utf8")), config.discovery.maxDiscovered);
    writeFileSync(join(root, "factory", "ideas-discovered.json"), JSON.stringify(next, null, 2) + "\n");
    merged.push("ideas-discovered.json");
  }
  const ledgerDir = join(records, "factory", "ledger");
  if (existsSync(ledgerDir)) {
    for (const f of readdirSync(ledgerDir)) {
      const day = f.replace(/\.json$/, "");
      if (!DAY.test(day) || !f.endsWith(".json")) throw new Error(`fichier de ledger inattendu : ${f}`);
      const next = validateLedger(config, readLedger(root, day), JSON.parse(readFileSync(join(ledgerDir, f), "utf8")));
      const p = join(root, "factory", "ledger", f);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify(next, null, 2) + "\n");
      merged.push(p);
    }
  }
  const runsDir = join(records, "factory", "runs");
  if (existsSync(runsDir)) {
    for (const entry of readdirSync(runsDir)) {
      const src = join(runsDir, entry);
      if (entry === "streaks.json") {
        const streaks = JSON.parse(readFileSync(src, "utf8"));
        for (const v of Object.values(streaks)) if (!Number.isInteger(v) || v < 0) throw new Error("série invalide");
        cpSync(src, join(root, "factory", "runs", entry));
        merged.push(entry);
      } else if (DAY.test(entry) && statSync(src).isDirectory()) {
        for (const f of readdirSync(src)) {
          if (!RUN_ID.test(f.replace(/\.json$/, "")) || !f.endsWith(".json")) throw new Error(`journal inattendu : ${f}`);
          JSON.parse(readFileSync(join(src, f), "utf8"));
          mkdirSync(join(root, "factory", "runs", entry), { recursive: true });
          cpSync(join(src, f), join(root, "factory", "runs", entry, f));
          merged.push(f);
        }
      } else {
        throw new Error(`entrée inattendue dans les journaux : ${entry}`);
      }
    }
  }
  return merged;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const records = process.argv[2];
  if (!records || !existsSync(records)) {
    console.log("aucun enregistrement à fusionner");
    process.exit(0);
  }
  console.log(`${mergeRecords(root, records).length} fichier(s) fusionné(s)`);
}
