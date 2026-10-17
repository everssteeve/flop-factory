#!/usr/bin/env node
// Avant qu'ils quittent le job agent, les enregistrements (journaux de run,
// idées découvertes) sont fouillés : la branche data est publique. Un fichier
// qui contient la clé, sous une forme ou une autre, est remplacé par une note ;
// le ledger, écrit par le code de l'usine, n'est jamais concerné.
//
//   ANTHROPIC_API_KEY=... node scripts/redact-leaks.mjs <records-dir>

import { writeFileSync, rmSync } from "node:fs";
import { basename } from "node:path";
import { findLeaks } from "./leak-check.mjs";

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const dir = process.argv[2];
  const hits = findLeaks(dir, process.env.ANTHROPIC_API_KEY);
  for (const p of hits) {
    if (basename(p) === "ideas-discovered.json") rmSync(p);
    else writeFileSync(p, JSON.stringify({ redacted: true, reason: "clé retrouvée dans ce journal" }) + "\n");
    console.log(`::warning::fuite expurgée : ${p}`);
  }
  console.log(`${hits.length} fichier(s) expurgé(s)`);
}
