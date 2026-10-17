#!/usr/bin/env node
// Cherche la clé API du run dans les fichiers produits par l'agent, en clair et
// sous des encodages courants. Ne l'imprime jamais. Dernier filet avant toute
// publication : la vraie protection est la sandbox (pas de réseau, variables
// retirées) et la limite de dépense posée dans la Console Anthropic.
//
//   ANTHROPIC_API_KEY=... node scripts/leak-check.mjs <dir>

import { readdirSync, readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";

export function encodings(secret) {
  const b = Buffer.from(secret);
  const forms = [
    secret,
    b.toString("base64"),
    b.toString("base64url"),
    b.toString("hex"),
    [...secret].reverse().join(""),
    encodeURIComponent(secret),
  ];
  // Fragments : une clé découpée en morceaux reste repérable par son milieu.
  if (secret.length >= 24) forms.push(secret.slice(8, 24));
  return forms.filter((f) => f.length >= 12);
}

// Liens symboliques et fichiers spéciaux ignorés (un lien vers /dev/zero
// bloquerait la fouille) ; ils ne sortent jamais du job de toute façon.
function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isDirectory()) yield* files(p);
    else if (st.isFile()) yield p;
  }
}

export function findLeaks(dir, secret) {
  if (!secret) return [];
  const forms = encodings(secret);
  const hits = [];
  for (const p of files(dir)) {
    const text = readFileSync(p).toString("latin1");
    const flat = text.replace(/[\s"'+,]/g, "");
    if (forms.some((f) => text.includes(f) || flat.includes(f))) hits.push(p);
  }
  return hits;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const hits = findLeaks(process.argv[2], process.env.ANTHROPIC_API_KEY);
  if (hits.length) {
    console.error(`Fuite possible de la clé API dans : ${hits.join(", ")}. Publication bloquée. Révoque la clé.`);
    process.exit(1);
  }
  console.log("aucune trace de la clé API");
}
